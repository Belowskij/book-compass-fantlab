import { readdir,readFile,writeFile } from 'node:fs/promises';
const files=(await readdir('dist/assets')).map(f=>`/assets/${f}`);
let sw=await readFile('dist/sw.js','utf8');sw=sw.replace("c.addAll(['/','/icon.svg','/manifest.webmanifest'])",`c.addAll(${JSON.stringify(['/','/icon.svg','/manifest.webmanifest',...files])})`);sw=sw.replace('book-compass-shell-v1',`book-compass-shell-${files.join('-').replace(/[^a-zA-Z0-9]/g,'')}`);await writeFile('dist/sw.js',sw);
const packageInfo=JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/build-info.json',JSON.stringify({version:packageInfo.version,commit:process.env.VERCEL_GIT_COMMIT_SHA||null,branch:process.env.VERCEL_GIT_COMMIT_REF||null,builtAt:new Date().toISOString()},null,2)+'\n');
