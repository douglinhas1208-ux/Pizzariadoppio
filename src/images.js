/*
 * Fotos de pizzas administradas pelo Doppio Admin.
 * Armazenamento compacto no D1: JPEG redimensionado pelo navegador, ate 350 KiB.
 * Fotos publicas nao contem informacoes de clientes nem secrets.
 */
const MAX_IMAGE_BYTES=350*1024;
const MAX_BASE64=Math.ceil(MAX_IMAGE_BYTES/3)*4;
const MAX_PHOTOS=120;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
let schemaReady=null;
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
}});
const error=(code,message,status=400)=>json({ok:false,code,message},status);
async function ensurePhotoDb(env){
  if(!schemaReady){
    schemaReady=env.DOPPIO_DB.exec(
      'CREATE TABLE IF NOT EXISTS doppio_photos ('
      +'id TEXT PRIMARY KEY, name TEXT NOT NULL, jpeg_base64 TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);'
      +'CREATE INDEX IF NOT EXISTS doppio_photos_created_idx ON doppio_photos(created_at DESC);'
    ).catch(err=>{schemaReady=null;throw err;});
  }
  await schemaReady;
}
function validJpeg(b64){
  if(typeof b64!=='string'||!b64.length||b64.length>MAX_BASE64||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))return null;
  let binary;
  try{binary=atob(b64);}catch(_){return null;}
  if(binary.length<500||binary.length>MAX_IMAGE_BYTES)return null;
  if(binary.charCodeAt(0)!==0xff||binary.charCodeAt(1)!==0xd8||binary.charCodeAt(2)!==0xff
    ||binary.charCodeAt(binary.length-2)!==0xff||binary.charCodeAt(binary.length-1)!==0xd9)return null;
  return binary.length;
}
export async function servePhoto(request,env,url){
  if(request.method!=='GET'&&request.method!=='HEAD')return error('method','Método não permitido.',405);
  const id=url.pathname.slice('/api/photo/'.length).toLowerCase();
  if(!UUID.test(id))return error('not_found','Foto não encontrada.',404);
  if(!env.DOPPIO_DB)return error('not_ready','Imagem indisponível.',503);
  try{
    await ensurePhotoDb(env);
    const row=await env.DOPPIO_DB.prepare('SELECT jpeg_base64,size FROM doppio_photos WHERE id=?').bind(id).first();
    if(!row)return error('not_found','Foto não encontrada.',404);
    const headers={'content-type':'image/jpeg','cache-control':'public, max-age=3600',
      'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'};
    if(request.method==='HEAD')return new Response(null,{status:200,headers});
    const binary=atob(row.jpeg_base64);
    const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
    return new Response(bytes,{status:200,headers});
  }catch(_){return error('image_error','Não foi possível carregar a foto.',503);}
}
export async function adminPhotoApi(request,env,url){
  if(!env.DOPPIO_DB)return error('not_ready','Banco de imagens indisponível.',503);
  try{await ensurePhotoDb(env);}catch(_){return error('image_error','Banco de imagens indisponível.',503);}
  if(url.pathname==='/api/admin/images'&&request.method==='GET'){
    try{
      const rows=await env.DOPPIO_DB.prepare('SELECT id,name,size,created_at FROM doppio_photos ORDER BY created_at DESC LIMIT 120').all();
      return json({ok:true,images:(rows.results||[]).map(row=>({
        path:'api/photo/'+row.id,name:row.name,size:row.size,createdAt:row.created_at
      }))});
    }catch(_){return error('database_error','Não foi possível listar as fotos.',503);}
  }
  if(url.pathname==='/api/admin/images'&&request.method==='POST'){
    if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
      return error('type','Envie uma imagem JPEG compactada.',415);
    if(Number(request.headers.get('content-length')||0)>550000)return error('too_large','Foto maior que o limite. Tente uma imagem menor.',413);
    let input;
    try{
      const raw=await request.text();
      if(raw.length>550000)throw Error('large');
      input=JSON.parse(raw);
    }catch(_){return error('invalid_image','Não foi possível ler a foto enviada.',422);}
    const bytes=validJpeg(input?.base64);
    if(!bytes)return error('invalid_image','A foto deve ser JPEG de até 350 KB. Tente novamente.',422);
    let name=typeof input.name==='string'?input.name.replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,90):'Nova foto';
    if(!name)name='Nova foto';
    try{
      const c=await env.DOPPIO_DB.prepare('SELECT COUNT(*) AS n FROM doppio_photos').first();
      if(Number(c?.n||0)>=MAX_PHOTOS)return error('limit','Limite de 120 fotos atingido.',409);
      const id=crypto.randomUUID();
      await env.DOPPIO_DB.prepare('INSERT INTO doppio_photos (id,name,jpeg_base64,size,created_at) VALUES (?,?,?,?,?)')
        .bind(id,name,input.base64,bytes,Math.floor(Date.now()/1000)).run();
      return json({ok:true,image:{path:'api/photo/'+id,name,size:bytes}},201);
    }catch(_){return error('database_error','Não foi possível salvar a foto.',503);}
  }
  const match=/^\/api\/admin\/images\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if(match&&request.method==='DELETE'){
    const id=match[1].toLowerCase();
    if(!UUID.test(id))return error('invalid_image','Foto inválida.',422);
    try{
      const state=await env.DOPPIO_DB.prepare('SELECT data FROM admin_state WHERE id=1').first();
      if(state?.data){
        const parsed=JSON.parse(state.data);
        if(parsed.products?.some(p=>p.image==='api/photo/'+id))
          return error('in_use','Esta foto está sendo utilizada em um sabor. Escolha outra foto e salve antes de excluir.',409);
      }
      const result=await env.DOPPIO_DB.prepare('DELETE FROM doppio_photos WHERE id=?').bind(id).run();
      return result.meta?.changes?json({ok:true,deleted:true}):error('not_found','Foto não encontrada.',404);
    }catch(_){return error('database_error','Não foi possível excluir a foto.',503);}
  }
  return error('not_found','Rota não encontrada.',404);
}
