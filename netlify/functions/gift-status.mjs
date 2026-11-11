// netlify/functions/gift-status.mjs
// Resumen público de regalos que los invitados reportaron haber transferido.
// Ningún nombre, IP, mensaje, dato bancario o identificador de donante sale de la función.
// Para corregir un reporte equivocado, agrega su ID a excludedSubmissionIds en estado-boda.json.
const FORM_ID = '6ae90495110c485fc207b6b1';
const PER_PAGE = 100;
const MAX_PAGES = 20;
const REFERENCE_TO_EXPERIENCE = Object.freeze({
  "LM-OAX01": "EXP-01",
  "LM-OAX02": "EXP-02",
  "LM-OAX03": "EXP-03",
  "LM-OAX04": "EXP-04",
  "LM-OAX05": "EXP-05",
  "LM-IT01": "EXP-20",
  "LM-IT02": "EXP-21",
  "LM-IT03": "EXP-22",
  "LM-IT04": "EXP-23",
  "LM-IT05": "EXP-24",
  "LM-IT06": "EXP-25",
  "LM-IT07": "EXP-26",
  "LM-TR01": "EXP-13",
  "LM-TR02": "EXP-14",
  "LM-TR03": "EXP-15",
  "LM-TR04": "EXP-16",
  "LM-TR05": "EXP-17",
  "LM-TR06": "EXP-18",
  "LM-TR07": "EXP-19",
  "LM-GR01": "EXP-06",
  "LM-GR02": "EXP-07",
  "LM-GR03": "EXP-08",
  "LM-GR04": "EXP-09",
  "LM-GR05": "EXP-10",
  "LM-GR06": "EXP-11",
  "LM-GR07": "EXP-12"
});

function json(body,status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff'
    }
  });
}

function normalizeName(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim().slice(0,100);
}

async function getCorrections(requestUrl) {
  // El archivo es público, pero solo contiene ajustes e IDs opacos, nunca datos bancarios.
  try {
    const url=new URL('/estado-boda.json',requestUrl);
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)return {};
    const data=await response.json();
    return data && data.schemaVersion===1 && typeof data==='object' ? data : {};
  }catch(_error){return {};}
}

export default async function handler(request) {
  if(request.method!=='GET')return json({error:'Método no permitido'},405);
  const token=(typeof Netlify!=='undefined' && Netlify.env?.get('NETLIFY_FORMS_READ_TOKEN'))
    || process.env.NETLIFY_FORMS_READ_TOKEN;
  if(!token)return json({error:'Sincronización no configurada'},503);

  try {
    const corrections=await getCorrections(request.url);
    const excluded=new Set(Array.isArray(corrections.excludedSubmissionIds)
      ? corrections.excludedSubmissionIds.filter(x=>typeof x==='string') : []);
    const records=[];
    let finished=false;
    for(let page=1; page<=MAX_PAGES; page++) {
      const endpoint=new URL('https://api.netlify.com/api/v1/forms/'+FORM_ID+'/submissions');
      endpoint.searchParams.set('page',String(page));
      endpoint.searchParams.set('per_page',String(PER_PAGE));
      const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
      if(!response.ok)return json({error:'No se pudo actualizar la disponibilidad'},502);
      const entries=await response.json();
      if(!Array.isArray(entries))return json({error:'Respuesta inesperada de Netlify'},502);
      for(const submission of entries) {
        if(!submission || excluded.has(String(submission.id||'')))continue;
        const data=submission.data||{};
        const ref=String(data.reference||'').trim().toUpperCase();
        const giftId=REFERENCE_TO_EXPERIENCE[ref];
        const amount=Number(data.amountMXN);
        if(!giftId || !Number.isSafeInteger(amount) || amount<1 || amount>250000)continue;
        const name=normalizeName(data.guestName);
        if(!name)continue;
        records.push({giftId,ref,amount,name,at:Date.parse(submission.created_at||'')||0});
      }
      if(entries.length<PER_PAGE){finished=true;break;}
    }
    if(!finished)return json({error:'Demasiados registros para esta consulta'},503);

    // Respuestas repetidas con mismo nombre, monto y experiencia dentro de 10 minutos
    // se consideran un solo aviso (protege contra doble clic/reintentos).
    records.sort((a,b)=>a.at-b.at);
    const totals=Object.create(null);
    const lastNotice=new Map();
    for(const item of records) {
      const key=item.giftId+'|'+item.name+'|'+item.amount;
      const previous=lastNotice.get(key);
      if(previous!==undefined && item.at-previous>=0 && item.at-previous<600000)continue;
      lastNotice.set(key,item.at);
      totals[item.giftId]=(totals[item.giftId]||0)+item.amount;
    }

    const manual=corrections.experiences && typeof corrections.experiences==='object'
      ? corrections.experiences : {};
    const allIds=new Set([...Object.values(REFERENCE_TO_EXPERIENCE),...Object.keys(manual)]);
    const experiences={};
    for(const id of allIds) {
      if(!/^EXP-\d{2}$/.test(id))continue;
      let sum=totals[id]||0;
      const override=manual[id];
      // Compatibilidad con estados publicados antes del modo automático.
      // Si existe override de importe, sustituye al automático: NO se suman ambos.
      if(override && typeof override==='object' &&
        Number.isFinite(Number(override.confirmedMXN)) &&
        Number(override.confirmedMXN)>=0) {
        sum=Math.round(Number(override.confirmedMXN));
      }
      const state={confirmedMXN:sum};
      if(override?.status==='completed')state.status='completed';
      if(override?.status==='available')state.status='available';
      experiences[id]=state;
    }
    return json({schemaVersion:1,experiences});
  }catch(_error){
    return json({error:'Disponibilidad temporalmente no accesible'},502);
  }
}
