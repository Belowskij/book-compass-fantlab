import { response } from '../server/fantlab.js';
export default async function handler(req:any,res:any){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Поддерживаются только запросы GET.'})}
 const url=new URL(req.url,'https://book-compass.local');const result=await response(url);
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control',result.status===200?'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400':'no-store');
 return res.status(result.status).json(result.body);
}
