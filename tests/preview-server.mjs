// Local-only UI harness. The shipped extension has no HTTP server or mock APIs.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const extension=new URL('../extension/',import.meta.url);
const allowed=new Set(['popup.html','popup.css','popup.js','presentation.js','url.js','setup.html','background.js','queue.js','worker-client.js']);
const mime={html:'text/html',css:'text/css',js:'text/javascript'};
createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1) || 'popup.html';
  if(!allowed.has(name) && name!=='preview-chrome.js'){res.writeHead(404);res.end('Not found');return;}
  try {
    let body=await readFile(name==='preview-chrome.js' ? new URL(name,import.meta.url) : new URL(name,extension),'utf8');
    if(name==='popup.html')body=body.replace('src="popup.js"','src="/preview-chrome.js"');
    res.writeHead(200,{'Content-Type':`${mime[name.split('.').pop()]}; charset=utf-8`,'Cache-Control':'no-store'});res.end(body);
  }catch {res.writeHead(500);res.end('Preview could not be loaded');}
}).listen(4178,'127.0.0.1',()=>console.log(`YT Drop sample UI: http://127.0.0.1:4178/popup.html (assets: ${fileURLToPath(extension)})`));
