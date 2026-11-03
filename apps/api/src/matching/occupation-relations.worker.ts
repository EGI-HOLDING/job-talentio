import {parentPort,workerData} from 'node:worker_threads';
import {buildProfessionGraph} from './occupation-relations';
if(parentPort)parentPort.postMessage(buildProfessionGraph(workerData.roles,workerData.source));
