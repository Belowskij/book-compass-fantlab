import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { response } from './server/fantlab';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
if(process.env.HTTPS_PROXY)setGlobalDispatcher(new EnvHttpProxyAgent());
export default defineConfig({plugins:[react(),{name:'fantlab-dev-api',configureServer(server){server.middlewares.use('/api/fantlab',async(req,res)=>{const result=await response(new URL(req.url??'/','http://localhost'));res.statusCode=result.status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result.body))})}}]});
