// Simulate Gemini Live calling the memory tools against the real VoiceService method (no Electron).
const Module=require('module');const orig=Module._load;
Module._load=function(r,...a){if(r==='electron')return{app:{getPath:()=>'/tmp'},safeStorage:{isEncryptionAvailable:()=>false}};return orig.call(this,r,...a)};
const {VoiceService}=require('../../src/main/services/voice-service.js');
const {MemoryStore}=require('../../src/main/services/memory-store.js');
const {ReminderService}=require('../../src/main/services/reminder-service.js');
const fs=require('fs'),os=require('os'),path=require('path');
const d=fs.mkdtempSync(path.join(os.tmpdir(),'lv-'));
const v=Object.create(VoiceService.prototype);
v.memoryStore=new MemoryStore({filePath:path.join(d,'m.enc'),safeStorage:{isEncryptionAvailable:()=>false}});
v.reminderService=new ReminderService({filePath:path.join(d,'r.json')});
const sent=[];v.liveSocket={readyState:1,send:(x)=>sent.push(JSON.parse(x))};v.emit=()=>{};
v.handleLiveMessage({toolCall:{functionCalls:[
 {id:'1',name:'save_memory',args:{category:'personal',key:'age',value:'20',text:'The user is 20 years old'}},
 {id:'2',name:'save_memory',args:{category:'personal',key:'name',value:'தயா',text:'பயனரின் பெயர் தயா'}},
 {id:'3',name:'save_memory',args:{category:'knowledge',text:'my password is 1234'}},
 {id:'4',name:'set_reminder',args:{text:'drink water',due:new Date(Date.now()+600000).toISOString(),repeat:'none'}}]}});
const assert=require('assert');
assert.deepStrictEqual(sent[0].toolResponse.functionResponses.map(r=>r.response.result),['saved','saved','rejected','reminder set']);
assert.deepStrictEqual(v.memoryStore.list('all').items.map(i=>i.text),['The user is 20 years old',"The user's name is Daya"]);
console.log(JSON.stringify(sent[0].toolResponse.functionResponses.map(r=>r.response)));
console.log(v.memoryStore.list('all').items.map(i=>i.text));
v.handleLiveMessage({toolCall:{functionCalls:[{id:'5',name:'forget_memory',args:{phrase:'age'}}]}});
assert.strictEqual(v.memoryStore.list('all').items.length,1);
console.log('  live memory tools ok');
//.toolResponse.functionResponses[0].response), v.memoryStore.list('all').items.length);
