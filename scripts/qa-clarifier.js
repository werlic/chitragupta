const ts=require(process.cwd()+'/node_modules/typescript');
const fs=require('fs');
const contacts=JSON.parse(fs.readFileSync('data/datapack/contacts.json','utf8')).contacts;
const src=fs.readFileSync('src/lib/agent/clarifier.ts','utf8').replace(/\r\n/g,'\n');
const code=ts.transpileModule(src,{compilerOptions:{module:'commonjs',target:'es2020'}}).outputText;
const mod={exports:{}};
const req=(n)=>{
  if(n==='@/lib/db')return{prisma:{contact:{findMany:async()=>contacts}}};
  if(n==='@/lib/llm')return{getLLMProviderAsync:async()=>({parseJSON:async()=>({questions:[]})})};
  if(n==='@/lib/contacts/match'){const t=require(process.cwd()+'/node_modules/typescript');const m={exports:{}};new Function('module','exports',t.transpileModule(fs.readFileSync('src/lib/contacts/match.ts','utf8'),{compilerOptions:{module:'commonjs',target:'es2020'}}).outputText)(m,m.exports);return m.exports;}
  return{};};
new Function('require','module','exports',code)(req,mod,mod.exports);
const {clarify}=mod.exports;
const cand=(owner,extra={})=>({id:'c1',title:'t',owner,commitmentStatus:'accepted',actionType:'task',dueDate:'2026-10-30',...extra});
let fail=0;
async function t(name,cands,text,parts,expect){
  const q=await clarify(cands,text,parts);
  const types=q.map(x=>x.type).sort().join(',');
  const ok=types===expect;if(!ok)fail++;
  console.log((ok?'PASS':'FAIL')+' | '+name+' | got=['+types+'] expect=['+expect+']'+(q[0]&&q[0].options?' opts='+q[0].options.map(o=>o.label.split(' (')[0]).join('/'):''));
}
(async()=>{
 await t('Pak Budi -> tanya',[cand('Pak Budi')],'x',[],'contact_ambiguity');
 await t('Budi (tanpa honorifik) -> tanya',[cand('Budi')],'x',[],'contact_ambiguity');
 await t('Budi Santoso -> tidak tanya',[cand('Budi Santoso')],'x',[],'');
 await t('Budi Hartono -> tidak tanya',[cand('Budi Hartono')],'x',[],'');
 await t('Bu Sari -> tidak tanya',[cand('Bu Sari')],'x',[],'');
 await t('Sari Wijaya -> tidak tanya',[cand('Sari Wijaya')],'x',[],'');
 await t('Pak Hendra -> tidak tanya',[cand('Pak Hendra')],'x',[],'');
 await t('Owner tak dikenal -> tidak tanya',[cand('Zainal')],'x',[],'');
 await t('Jam 15:00 tanpa zona, owner+peserta lintas zona -> tanya zona',[cand('Sari Wijaya',{dueTime:'15:00'})],'rapat jam 3 sore',['Budi Hartono'],'timezone_reference');
 await t('Jam 15:00 tanpa zona, semua WIB -> tidak tanya',[cand('Sari Wijaya',{dueTime:'15:00'})],'rapat jam 3 sore',['Dewi Lestari'],'');
 await t('Jam 15:00 teks ada WITA -> tidak tanya',[cand('Sari Wijaya',{dueTime:'15:00'})],'jam 15:00 WITA',['Budi Hartono'],'');
 await t('Tanpa dueTime -> tidak tanya zona',[cand('Sari Wijaya')],'x',['Budi Hartono'],'');
 console.log(fail?'\nFAILED '+fail:'\nALL PASS');process.exit(fail?1:0);
})();
