import {WorkerRuntime} from './workerRuntime.js';
import type {WorkerRequest,WorkerResponse} from './protocol.js';
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<WorkerRequest>)=>void)|null;postMessage:(message:WorkerResponse,transfer?:ArrayBuffer[])=>void};
const runtime=new WorkerRuntime((message,transfer)=>scope.postMessage(message,transfer));
scope.onmessage=event=>runtime.command(event.data);
