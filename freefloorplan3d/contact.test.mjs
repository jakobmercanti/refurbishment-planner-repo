import test from 'node:test';
import assert from 'node:assert/strict';
import {handleContact} from './contact.mjs';
const origin = 'https://www.freefloorplan3d.com';
const valid = {name:'Alex Example',email:'alex@example.com',subject:'A question about the planner',message:'Can I prepare a layout for a two-bedroom home?',token:'test-token',website:''};
function request(data = valid, headers = {}) {return new Request(origin+'/api/contact',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...headers},body:JSON.stringify(data)});}
function setup({verification = {}, limited = false, failSend = false} = {}) {
 const sent = [];let checks = 0;
 return {sent,get checks(){return checks;},env:{TURNSTILE_SECRET:'not-a-real-secret',CONTACT_RATE_LIMIT:{async limit(){return {success:!limited};}},CONTACT_EMAIL:{async send(message){if(failSend)throw new Error('Private provider details');sent.push(message);}}},
 verify:async(url,options)=>{checks++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(JSON.parse(options.body).response,'test-token');return Response.json({success:true,hostname:'www.freefloorplan3d.com',action:'contact',...verification});}};
}
test('verified enquiry sends only to the fixed recipient and supports replying to the visitor',async()=>{
 const s=setup();const result=await handleContact(request({...valid,to:'attacker@example.com'}),s.env,s.verify);
 assert.equal(result.status,200);assert.equal(s.sent.length,1);assert.equal(s.sent[0].to,'plannerbuildteam@gmail.com');assert.equal(s.sent[0].replyTo,'alex@example.com');assert.equal(s.sent[0].from.email,'contact@freefloorplan3d.com');assert(s.sent[0].text.includes(valid.message));assert.equal(s.sent[0].html,undefined);assert.equal(result.headers.get('cache-control'),'no-store');
});
test('validation and header injection attempts do not send emails or call Turnstile',async()=>{
 for(const change of [{email:'bad-email'},{email:'a@example.com\r\nBcc: bad@example.com'},{name:'A\r\nInjected: yes'},{subject:'Hello\nBcc: bad@example.com'},{message:'short'},{message:'a'.repeat(5001)},{name:'a'.repeat(101)},{subject:'a'.repeat(151)},{website:'https://spam.example'},{token:''},{name:42}]){
  const s=setup();const response=await handleContact(request({...valid,...change}),s.env,s.verify);assert.equal(response.status,400,JSON.stringify(change).slice(0,100));assert.equal(s.sent.length,0);assert.equal(s.checks,0);
 }
});
test('origin, method, type and body-size protections fail closed',async()=>{
 const s=setup();assert.equal((await handleContact(request(valid,{Origin:'https://elsewhere.example'}),s.env,s.verify)).status,403);
 assert.equal((await handleContact(new Request(origin+'/api/contact'),s.env,s.verify)).status,405);
 assert.equal((await handleContact(request(valid,{'Content-Type':'text/plain'}),s.env,s.verify)).status,415);
 assert.equal((await handleContact(request({...valid,message:'x'.repeat(40000)}),s.env,s.verify)).status,413);
 assert.equal((await handleContact(request(null),s.env,s.verify)).status,400);assert.equal(s.sent.length,0);
});
test('Turnstile rejects failed tokens, wrong hosts and wrong actions',async()=>{
 for(const verification of [{success:false},{hostname:'elsewhere.example'},{action:'login'}]){
  const s=setup({verification});assert.equal((await handleContact(request(),s.env,s.verify)).status,400);assert.equal(s.sent.length,0);
 }
});
test('rate limits, unavailable verification, missing configuration and send failures never claim success',async()=>{
 const rate=setup({limited:true});const limited=await handleContact(request(),rate.env,rate.verify);assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal(rate.checks,0);
 assert.equal((await handleContact(request(),{})).status,503);
 const s=setup();assert.equal((await handleContact(request(),s.env,async()=>{throw Error('Network failure');})).status,503);
 const failing=setup({failSend:true});const response=await handleContact(request(),failing.env,failing.verify);assert.equal(response.status,503);assert(!(await response.text()).includes('Private provider details'));assert.equal(failing.sent.length,0);
});
