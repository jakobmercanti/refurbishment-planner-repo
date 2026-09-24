import http from 'node:http';
import worker from './worker.generated.mjs';
http.createServer(async (req,res)=>{
 try{const response=await worker.fetch(new Request('http://localhost:4175'+req.url,{method:req.method,headers:req.headers}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
 catch(error){console.error(error);res.writeHead(500);res.end('Preview error');}
}).listen(4175,'127.0.0.1',()=>console.log('Local: http://localhost:4175'));
