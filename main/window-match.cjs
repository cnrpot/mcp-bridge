const {parentPort,workerData}=require('worker_threads');
try{const re=new RegExp(workerData.pattern,'i');parentPort.postMessage(workerData.names.map((n,i)=>re.test(n)?i:-1).filter(i=>i>=0));}catch(e){parentPort.postMessage({error:e.message});}
