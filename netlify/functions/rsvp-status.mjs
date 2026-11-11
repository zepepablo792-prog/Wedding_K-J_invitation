// netlify/functions/rsvp-status.mjs
// Devuelve solo el estado mínimo de un código; jamás expone mensajes, dietas ni nombres.
const FORM_ID = '6aada8a81e51e300084e1c6e';
const PER_PAGE = 100;
const MAX_PAGES = 20;

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,headers:{'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'private, no-store, max-age=0',
      'X-Content-Type-Options':'nosniff'}
  });
}

export default async function handler(request){
  if(request.method!=='GET') return json({error:'Método no permitido'},405);
  const code=(new URL(request.url).searchParams.get('code')||'').trim().toUpperCase();
  if(!/^(JP-[A-Z0-9]{2,12}|KA-[0-9]{3})$/.test(code))
    return json({error:'Código inválido'},400);

  // Crear en Netlify como variable SECRETA con alcance Functions.
  const token=(typeof Netlify!=='undefined' && Netlify.env?.get('NETLIFY_FORMS_READ_TOKEN'))
    || process.env.NETLIFY_FORMS_READ_TOKEN;
  if(!token) return json({error:'Consulta de confirmaciones no configurada'},503);

  try{
    let latest=null;
    let finished=false;
    for(let page=1;page<=MAX_PAGES;page++){
      const endpoint=new URL('https://api.netlify.com/api/v1/forms/'+FORM_ID+'/submissions');
      endpoint.searchParams.set('page',String(page));
      endpoint.searchParams.set('per_page',String(PER_PAGE));
      const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok) return json({error:'No se pudo consultar el estado'},502);
      const entries=await response.json();
      if(!Array.isArray(entries))return json({error:'Respuesta inesperada'},502);
      for(const item of entries){
        const data=item?.data||{};
        if(String(data.guestCode||'').trim().toUpperCase()!==code)continue;
        if(data.attendance!=='Sí' && data.attendance!=='No')continue;
        const timestamp=Date.parse(item.created_at||data.submittedAt||'')||0;
        if(!latest || timestamp>latest.timestamp){
          latest={attendance:data.attendance,guests:data.attendance==='No' ? 0 :
            Math.max(0,Math.min(20,Number(data.guests)||0)),timestamp};
        }
      }
      if(entries.length<PER_PAGE){finished=true;break;}
    }
    // Evitar falsos negativos si el sitio supera el máximo de páginas permitido.
    if(!finished)return json({error:'Demasiadas respuestas para la consulta'},503);
    return json(latest ? {found:true,attendance:latest.attendance,guests:latest.guests} : {found:false});
  }catch(_error){
    return json({error:'Consulta temporalmente no disponible'},502);
  }
}
