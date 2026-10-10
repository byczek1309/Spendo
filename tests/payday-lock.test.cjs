const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('app.js','utf8');
const nodes = new Map();
const $ = key => { if(!nodes.has(key)) { const classes=new Set(); nodes.set(key,{value:'',disabled:false,textContent:'',listeners:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){on?classes.add(c):classes.delete(c);}},addEventListener(name,fn){this.listeners[name]=fn;}}); } return nodes.get(key); };
const storage={value:null,writes:0,fail:false,getItem(){if(this.fail==='read')throw Error('blocked');return this.value;},setItem(key,value){assert.equal(key,'dzienny.v1');if(this.fail)throw Error('quota');this.writes++;this.value=value;}};
let updates=0,toasts=[];
const ctx={window:{},Blob,$,localStorage:storage,KEY:'dzienny.v1',todayKey:'2026-10-10',update(){updates++;ctx.updatePaydayControl();},showToast:message=>toasts.push(message),applyTheme(){}};
vm.createContext(ctx);for(const file of ['budget-core.js','backup-core.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);ctx.Core=ctx.window.SpendoBudgetCore;
vm.runInContext(source.slice(source.indexOf('  function isPaydayLocked('),source.indexOf("  matchMedia('(prefers-color-scheme: dark)')",source.indexOf('  function isPaydayLocked('))),ctx);
vm.runInContext(source.slice(source.indexOf("  $('#theme-select').addEventListener"),source.indexOf('  function isPaydayLocked(')),ctx);
ctx.save=()=>storage.setItem('dzienny.v1',JSON.stringify(ctx.state));
const clone=value=>JSON.parse(JSON.stringify(value));
const goal={id:'goal',name:'Test',targetAmount:1000,savedAmount:50,contributionPerPeriod:10,active:true,savedAmountConfirmed:true,targetDate:'',createdAt:'',lastAccruedPeriod:''};
const bill={id:'bill',name:'Test',amount:50};
const expense={id:'expense',amount:20,category:'Jedzenie',poolId:'life',date:'2026-10-10',note:'',created:''};
const plan={income:1000,bills:50,fuel:100,savings:100,otherBills:0,selectedBills:[{...bill,paid:true}]};
const base={...ctx.Core.blankState(),payday:10,savingsGoals:[goal],recurringBills:[bill]};
function reset(){ctx.state=clone(base);ctx.selectedPeriod=ctx.Core.periodForDate(ctx.todayKey,10);storage.value=JSON.stringify(ctx.state);storage.writes=0;storage.fail=false;updates=0;toasts=[];ctx.updatePaydayControl();}
function change(value){$('#payday-select').value=String(value);$('#payday-select').listeners.change({target:$('#payday-select')});}
let count=0;function test(name,fn){reset();fn();count++;console.log('OK '+name);}
function blockFixture(budgets,expenses){ctx.state.budgets=clone(budgets);ctx.state.expenses=clone(expenses);storage.value=JSON.stringify(ctx.state);ctx.updatePaydayControl();const raw=storage.value,period=JSON.stringify(ctx.selectedPeriod);assert.equal($('#payday-select').disabled,true);change(15);assert.equal(storage.writes,0);assert.equal(storage.value,raw);assert.equal(JSON.stringify(ctx.state),raw);assert.equal(JSON.stringify(ctx.selectedPeriod),period);assert.equal($('#payday-select').value,'10');assert.equal(updates,0);assert.equal(toasts.length,0);}
test('no budgets/expenses: 10 → 15 is allowed, related data unchanged',()=>{assert.equal($('#payday-select').disabled,false);change(15);assert.equal(storage.writes,1);assert.equal(ctx.state.payday,15);assert.equal(ctx.selectedPeriod.start,'2026-09-15');for(const field of ['budgets','expenses','savingsGoals','recurringBills'])assert.equal(JSON.stringify(ctx.state[field]),JSON.stringify(base[field]));assert.equal(toasts.length,1);});
test('historical budget alone locks selector and change handler',()=>{blockFixture({'2020-01':plan},[]);assert.match($('#payday-lock-note').textContent,/po zapisaniu budżetu/);});
test('expenses without budget lock selector and handler',()=>{blockFixture({},[expense]);assert.match($('#payday-lock-note').textContent,/masz zapisane wydatki/);});
test('budgets, snapshots, paid statuses, goals and expenses preserved',()=>blockFixture({'2026-09':plan,'2026-10':plan},[expense]));
test('even incomplete stored plan blocks changes conservatively',()=>blockFixture({'2020-01':{}},[]));
test('same day and invalid day do not write',()=>{for(const day of [10,0,32,'bad'])change(day);assert.equal(storage.writes,0);assert.equal(ctx.state.payday,10);});
test('reload preserves old payday after blocked attempt',()=>{blockFixture({'2026-10':plan},[expense]);assert.equal(ctx.Core.normalizeState(JSON.parse(storage.value)).state.payday,10);});
test('reload preserves allowed new payday',()=>{change(31);assert.equal(ctx.Core.normalizeState(JSON.parse(storage.value)).state.payday,31);});
test('storage write failure keeps state, period and selector unchanged',()=>{const raw=storage.value,p=JSON.stringify(ctx.selectedPeriod);storage.fail=true;change(15);assert.equal(storage.value,raw);assert.equal(JSON.stringify(ctx.state),raw);assert.equal(JSON.stringify(ctx.selectedPeriod),p);assert.equal($('#payday-select').value,'10');assert.equal(toasts.length,0);assert.equal(updates,0);assert.match($('#payday-error').textContent,/Poprzednie ustawienie/);});
test('storage read failure does not write',()=>{storage.fail='read';change(15);assert.equal(storage.writes,0);assert.equal(ctx.state.payday,10);assert.equal(toasts.length,0);});
test('data from another tab cannot be overwritten',()=>{const saved=clone(base);saved.budgets['2026-10']=plan;storage.value=JSON.stringify(saved);change(15);assert.equal(storage.writes,0);assert.equal(JSON.parse(storage.value).payday,10);assert.equal(ctx.state.payday,10);assert.match($('#payday-error').textContent,/Odśwież/);});
test('theme setting still works when payday locked',()=>{blockFixture({'2026-10':plan},[expense]);$('#theme-select').listeners.change({target:{value:'dark'}});assert.equal(ctx.state.theme,'dark');assert.equal(ctx.state.payday,10);assert.equal(storage.writes,1);ctx.updatePaydayControl();assert.equal($('#payday-select').disabled,true);});
test('render refresh locks after first budget or imported expenses',()=>{ctx.state.budgets['2026-10']=clone(plan);ctx.updatePaydayControl();assert.equal($('#payday-select').disabled,true);ctx.state=clone(base);ctx.state.expenses=[clone(expense)];ctx.updatePaydayControl();assert.equal($('#payday-select').disabled,true);assert.match(source,/function renderBudget\(budget, amounts, spending\) \{\s+updatePaydayControl\(\)/);});
test('backup roundtrip preserves locked data and calculations',()=>{blockFixture({'2026-10':plan},[expense]);const imported=ctx.window.SpendoBackup.prepare(JSON.stringify(ctx.state,null,2)).state;assert.equal(JSON.stringify(imported),JSON.stringify(ctx.state));const period=ctx.Core.periodForDate(ctx.todayKey,10);assert.equal(ctx.Core.dailyPlan(period,750,imported.expenses,ctx.todayKey).safeToday,ctx.Core.dailyPlan(period,750,ctx.state.expenses,ctx.todayKey).safeToday);});
console.log(`${count} payday lock tests passed`);
