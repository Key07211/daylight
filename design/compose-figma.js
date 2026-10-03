
const ids=[];
const [root,detail,lib]=await Promise.all(["3:43","3:44","3:45"].map(id=>figma.getNodeByIdAsync(id)));
if(root.children.length) return {alreadyBuilt:true,root:root.id};
await Promise.all(["Regular","Medium","Bold"].map(style=>figma.loadFontAsync({family:"Noto Sans SC",style})));
await Promise.all(["Regular","Medium","Semi Bold"].map(style=>figma.loadFontAsync({family:"Inter",style})));
const vs=await figma.variables.getLocalVariablesAsync();const V=Object.fromEntries(vs.map(v=>[v.name.replace("color/",""),v]));
const ss=await figma.getLocalTextStylesAsync();const S=Object.fromEntries(ss.filter(s=>s.name.startsWith("Daylight/")).map(s=>[s.name.split("/")[1],s]));
function paint(key){return figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:1,g:1,b:1}},"color",V[key]);}
function mark(n){ids.push(n.id);return n;}
function fill(n,key){n.fills=key?[paint(key)]:[];}
function radius(n,v){n.cornerRadius=v;for(const k of ["topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"])n.setBoundVariable(k,V["radius/"+v]);}
function gap(n,s){n.itemSpacing=s;if(V["space/"+s])n.setBoundVariable("itemSpacing",V["space/"+s]);}
function pad(n,s){for(const k of ["paddingLeft","paddingRight","paddingTop","paddingBottom"]){n[k]=s;if(V["space/"+s])n.setBoundVariable(k,V["space/"+s]);}}
function frame(p,name,w,h,dir="VERTICAL",color){const n=mark(figma.createAutoLayout(dir));n.name=name;p.appendChild(n);n.resize(w,h);n.primaryAxisSizingMode="FIXED";n.counterAxisSizingMode="FIXED";fill(n,color);return n;}
function hug(n){n.primaryAxisSizingMode="AUTO";}
function text(p,str,style="Body",color="text",w){const t=mark(figma.createText());t.name=str.slice(0,32);t.fontName=S[style].fontName;t.textStyleId=S[style].id;t.characters=str;fill(t,color);p.appendChild(t);if(w){t.textAutoResize="HEIGHT";t.resize(w,t.height);}return t;}
function line(p,w){const n=mark(figma.createRectangle());n.name="Divider";n.resize(w,1);fill(n,"line");p.appendChild(n);return n;}
function spacer(p){const n=frame(p,"Spacer",1,1);n.layoutSizingVertical="FILL";return n;}
function svg(p,type,color="#7D8980",size=20){
const paths={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',calendar:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M16 3v4M8 3v4M4 11h16"/>',list:'<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>',check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',bot:'<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 2v4M8 11v2m8-2v2M9 17h6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',plus:'<path d="M12 5v14M5 12h14"/>',settings:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',circle:'<circle cx="12" cy="12" r="9"/>',chevron:'<path d="m9 5 7 7-7 7"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',flag:'<path d="M5 21V3h14l-3 5 3 5H5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
const n=mark(figma.createNodeFromSvg('<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="'+color+'" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">'+paths[type]+'</svg>'));p.appendChild(n);n.name="icon/"+type;ids.push(...n.findAll(()=>true).map(x=>x.id));return n;
}
function component(name,w,h,dir="HORIZONTAL"){const n=mark(figma.createComponent());n.name=name;n.layoutMode=dir;n.resize(w,h);n.primaryAxisSizingMode="FIXED";n.counterAxisSizingMode="FIXED";n.counterAxisAlignItems="CENTER";lib.appendChild(n);fill(n);return n;}
function prop(c,t,name,value){const k=c.addComponentProperty(name,"TEXT",value);t.componentPropertyReferences={characters:k};return k;}
function inst(c,p){const n=mark(c.createInstance());p.appendChild(n);ids.push(...n.findAll(()=>true).map(x=>x.id));return n;}
text(lib,"Daylight / 可复用组件","Title");text(lib,"按钮 · 导航 · 任务行","Caption","muted");
const primary=component("Button / Primary",132,42);radius(primary,8);fill(primary,"accent");primary.primaryAxisAlignItems="CENTER";gap(primary,8);svg(primary,"plus","#FFFFFF",18);const bp=prop(primary,text(primary,"新增任务","Label","surface"),"Label","新增任务");
const secondary=component("Button / Secondary",132,40);radius(secondary,8);fill(secondary,"surface");secondary.strokes=[paint("line")];secondary.primaryAxisAlignItems="CENTER";const bs=prop(secondary,text(secondary,"查看全部","Label","accent"),"Label","查看全部");
const nav=component("Navigation / Item",184,44);radius(nav,8);pad(nav,12);gap(nav,12);svg(nav,"calendar");const np=prop(nav,text(nav,"即将到来","Body"),"Label","即将到来");const nc=prop(nav,text(nav,"12","Caption","muted"),"Count","12");
const task=component("Task / Row",784,76);gap(task,16);task.paddingLeft=4;task.paddingRight=12;svg(task,"circle","#8D9C90",22);const tc=frame(task,"Task content",596,48);gap(tc,4);const tp=prop(task,text(tc,"完成课程阅读与学习笔记","Label"),"Title","完成课程阅读与学习笔记");const mp=prop(task,text(tc,"学习  ·  课程学习","Caption","muted"),"Meta","学习  ·  课程学习");const tm=prop(task,text(task,"09:30","Caption","muted"),"Time","09:30");svg(task,"flag","#D88A4B",16);
const sidebar=frame(root,"Sidebar",224,1000,"VERTICAL","sidebar");pad(sidebar,20);gap(sidebar,8);
const logo=frame(sidebar,"Brand",184,66,"HORIZONTAL");logo.counterAxisAlignItems="CENTER";gap(logo,10);svg(logo,"sun","#D88A4B",28);const lb=frame(logo,"Brand text",134,52);gap(lb,1);const word=text(lb,"Daylight","Title");word.fontName={family:"Inter",style:"Semi Bold"};word.fontSize=21;text(lb,"日光清单","Caption","muted");
const search=frame(sidebar,"Search",184,38,"HORIZONTAL","surface");radius(search,8);pad(search,8);gap(search,8);search.counterAxisAlignItems="CENTER";svg(search,"search",undefined,16);text(search,"搜索任务","Caption","muted");text(search,"⌘ K","Caption","muted");
frame(sidebar,"Navigation gap",184,12);
function navitem(label,count,icon,active=false){const n=inst(nav,sidebar);n.setProperties({[np]:label,[nc]:count});if(active)fill(n,"accentSoft");const old=n.findOne(x=>x.name==="icon/calendar");if(old)old.visible=false;const l=n.findAllWithCriteria({types:["TEXT"]});if(active)l.forEach(t=>fill(t,"accent"));return n;}
navitem("今天","6","sun",true);navitem("即将到来","12","calendar");navitem("全部任务","18","list");navitem("已完成","24","check");
frame(sidebar,"Nav gap",184,14);text(sidebar,"工作空间","Caption","muted");navitem("Codex 调度","2","bot");
frame(sidebar,"Project gap",184,14);const projecthead=frame(sidebar,"Projects heading",184,24,"HORIZONTAL");gap(projecthead,92);text(projecthead,"我的项目","Caption","muted");svg(projecthead,"plus",undefined,16);
for(const [label,color,count] of [["课程学习","#719183","8"],["产品开发","#A392BC","6"],["个人生活","#CFB38C","4"]]){const r=frame(sidebar,label,184,38,"HORIZONTAL");pad(r,8);gap(r,12);r.counterAxisAlignItems="CENTER";const dot=mark(figma.createEllipse());r.appendChild(dot);dot.resize(7,7);dot.fills=[{type:"SOLID",color:{r:parseInt(color.slice(1,3),16)/255,g:parseInt(color.slice(3,5),16)/255,b:parseInt(color.slice(5,7),16)/255}}];text(r,label,"Body");text(r,count,"Caption","muted");}
spacer(sidebar);line(sidebar,184);const settings=frame(sidebar,"Settings",184,40,"HORIZONTAL");gap(settings,12);settings.counterAxisAlignItems="CENTER";svg(settings,"settings");text(settings,"设置与提醒","Body");
const user=frame(sidebar,"Local account",184,56,"HORIZONTAL");gap(user,10);user.counterAxisAlignItems="CENTER";const av=frame(user,"Avatar",34,34,"HORIZONTAL","accentSoft");radius(av,8);av.counterAxisAlignItems="CENTER";av.primaryAxisAlignItems="CENTER";text(av,"Y","Label","accent");const up=frame(user,"Local storage",138,44);gap(up,2);text(up,"我的空间","Label");text(up,"数据保存在本机","Caption","muted");
const workspace=frame(root,"Workspace",1216,1000);
const topbar=frame(workspace,"Topbar",1216,64,"HORIZONTAL","surface");topbar.paddingLeft=48;topbar.paddingRight=32;topbar.counterAxisAlignItems="CENTER";gap(topbar,16);text(topbar,"我的空间   /   今天","Caption","muted");const spring=frame(topbar,"Flexible space",1,1);spring.layoutSizingHorizontal="FILL";text(topbar,"●  已保存到本机","Caption","muted");svg(topbar,"bell");const time=text(topbar,"2026.10.02","Caption","muted");
line(workspace,1216);
const content=frame(workspace,"Content",1216,935,"HORIZONTAL");
const main=frame(content,"Today main",880,935);main.paddingLeft=48;main.paddingRight=48;main.paddingTop=36;main.paddingBottom=32;gap(main,24);
const heading=frame(main,"Page header",784,72,"HORIZONTAL");heading.counterAxisAlignItems="CENTER";const ht=frame(heading,"Heading",632,72);gap(ht,5);text(ht,"今天，专注重要的事","Heading");text(ht,"10 月 2 日，星期五  ·  慢慢来，每一步都算数。","Body","muted");const add=inst(primary,heading);
const focus=frame(main,"Daily intention",784,86,"HORIZONTAL","bg");pad(focus,20);radius(focus,12);gap(focus,16);focus.counterAxisAlignItems="CENTER";svg(focus,"sun","#D88A4B",28);const ft=frame(focus,"Focus text",622,48);gap(ft,2);text(ft,"给今天一个清晰的开始","Section");text(ft,"还有 6 项待办，先从最重要的一件开始。","Caption","muted");svg(focus,"arrow","#7D8980",18);
const filter=frame(main,"List controls",784,38,"HORIZONTAL");filter.counterAxisAlignItems="CENTER";gap(filter,20);text(filter,"待办  6","Label","accent");text(filter,"已完成  2","Body","muted");const spring2=frame(filter,"Flexible space",1,1);spring2.layoutSizingHorizontal="FILL";text(filter,"按时间排序 ↓","Caption","muted");
function taskrow(p,title,meta,time,done=false){const i=inst(task,p);i.setProperties({[tp]:title,[mp]:meta,[tm]:time});if(done)i.opacity=0.5;return i;}
const morning=frame(main,"Morning tasks",784,256);gap(morning,0);text(morning,"上午","Caption","muted");taskrow(morning,"完成 课程学习 作业","课程学习   ·   优先处理","09:30");line(morning,784);taskrow(morning,"梳理日光清单第一版功能","产品开发   ·   提醒 10 分钟前","10:30");line(morning,784);taskrow(morning,"阅读 20 页，整理关键想法","个人生活","11:30");
const afternoon=frame(main,"Afternoon tasks",784,256);gap(afternoon,0);text(afternoon,"下午","Caption","muted");taskrow(afternoon,"让 Codex 整理本周学习笔记","课程学习   ·   Codex 自动执行","14:00");line(afternoon,784);taskrow(afternoon,"检查项目进度与下一步","产品开发","16:00");line(afternoon,784);taskrow(afternoon,"去户外走走，给自己留一点空白","个人生活","18:30");
const quick=frame(main,"Quick add",784,40,"HORIZONTAL");gap(quick,10);quick.counterAxisAlignItems="CENTER";svg(quick,"plus","#2F6559",18);text(quick,"添加任务","Body","accent");text(quick,"或按 N","Caption","muted");
const right=frame(content,"Daily context",336,935,"VERTICAL","bg");pad(right,28);gap(right,28);
const rheader=frame(right,"Daily overview header",280,36,"HORIZONTAL");rheader.counterAxisAlignItems="CENTER";text(rheader,"今日概览","Section");text(rheader,"  周五","Caption","muted");
const progress=frame(right,"Progress card",280,145,"VERTICAL","surface");pad(progress,20);radius(progress,12);gap(progress,10);text(progress,"一步一步，也在向前","Label");const pr=frame(progress,"Progress number",240,40,"HORIZONTAL");gap(pr,6);const number=text(pr,"2","Heading","accent");text(pr,"/ 8 项已完成","Caption","muted");const bar=frame(progress,"Progress bar",240,6,"HORIZONTAL","accentSoft");radius(bar,6);frame(bar,"25 percent",60,6,"HORIZONTAL","accent");text(progress,"今天已完成 25%","Caption","muted");
const agenda=frame(right,"Upcoming reminders",280,247);gap(agenda,18);text(agenda,"接下来","Label");
for(const [t,title,sub] of [["10:20","梳理第一版功能","10 分钟后到期"],["13:50","整理学习笔记","Codex 将在 14:00 开始"],["15:50","检查项目进度","提前 10 分钟提醒"]]){const a=frame(agenda,"Reminder "+t,280,54,"HORIZONTAL");gap(a,14);text(a,t,"Caption","muted");const at=frame(a,"Reminder text",222,54);gap(at,5);text(at,title,"Body");text(at,sub,"Caption","muted");}
line(right,280);
const codex=frame(right,"Codex schedule card",280,206,"VERTICAL","accentSoft");pad(codex,20);radius(codex,12);gap(codex,14);const ch=frame(codex,"Codex title",240,25,"HORIZONTAL");gap(ch,10);svg(ch,"bot","#2F6559",22);text(ch,"交给 Codex","Section","accent");text(codex,"让重复的工作，按时完成。","Body","accent");text(codex,"2 个调度已开启\n下次运行：今天 14:00","Caption","muted",240);const manage=inst(secondary,codex);manage.setProperties({[bs]:"管理调度   →"});manage.resize(240,40);
const local=frame(right,"Local note",280,54,"HORIZONTAL");gap(local,9);svg(local,"check","#8C9B8D",16);text(local,"安心记录，随时继续。\n任务和执行记录仅保存在本机。","Caption","muted",254);
detail.layoutMode="VERTICAL";pad(detail,32);gap(detail,24);fill(detail,"surface");
const dh=frame(detail,"Detail header",436,32,"HORIZONTAL");dh.primaryAxisAlignItems="SPACE_BETWEEN";text(dh,"新增任务","Title");svg(dh,"close");
const titlefield=frame(detail,"Title field",436,86);gap(titlefield,8);text(titlefield,"任务名称","Caption","muted");text(titlefield,"整理本周学习笔记","Title");line(titlefield,436);
const note=frame(detail,"Description",436,64);gap(note,8);text(note,"任务描述","Caption","muted");text(note,"回顾本周内容，按课程整理重点与待复习问题。","Body","text",436);
const fields=frame(detail,"Task properties",436,180);gap(fields,20);
for(const [label,value,icon] of [["截止时间","2026 年 10 月 2 日  14:00","calendar"],["项目 / 优先级","课程学习    ·    中优先级","flag"],["提醒","截止前 10 分钟","bell"]]){const r=frame(fields,label,436,40,"HORIZONTAL");gap(r,12);r.counterAxisAlignItems="CENTER";svg(r,icon);text(r,label,"Body","muted");const sp=frame(r,"Flexible space",1,1);sp.layoutSizingHorizontal="FILL";text(r,value,"Body");}
line(detail,436);
const cdetail=frame(detail,"Codex controls",436,242,"VERTICAL","bg");pad(cdetail,20);radius(cdetail,12);gap(cdetail,16);
const cdt=frame(cdetail,"Codex heading",396,28,"HORIZONTAL");gap(cdt,10);svg(cdt,"bot","#2F6559");text(cdt,"由 Codex 执行","Label");const sp3=frame(cdt,"Flexible space",1,1);sp3.layoutSizingHorizontal="FILL";const toggle=frame(cdt,"Enabled",36,22,"HORIZONTAL","accent");radius(toggle,12);toggle.paddingLeft=16;const dot=mark(figma.createEllipse());toggle.appendChild(dot);dot.resize(18,18);fill(dot,"surface");
text(cdetail,"执行提示词","Caption","muted");
const prompt=frame(cdetail,"Prompt input",396,88,"VERTICAL","surface");pad(prompt,12);radius(prompt,8);text(prompt,"阅读本周的课程笔记，按主题整理摘要、\n核心公式和需要继续复习的问题。","Body","text",372);
text(cdetail,"工作目录   ~/Projects/my-project","Caption","muted");text(cdetail,"执行频率   仅一次 · 到期时执行","Caption","muted");
const df=frame(detail,"Detail footer",436,44,"HORIZONTAL");df.primaryAxisAlignItems="SPACE_BETWEEN";const cancel=inst(secondary,df);cancel.setProperties({[bs]:"取消"});const save=inst(primary,df);save.setProperties({[bp]:"创建任务"});
const all=root.findAll(()=>true);const counts={};for(const n of all)counts[n.type]=(counts[n.type]||0)+1;
return {createdNodeIds:ids,mutatedNodeIds:[root.id,detail.id,lib.id],roots:{today:root.id,detail:detail.id,components:lib.id},components:{primary:primary.id,secondary:secondary.id,nav:nav.id,task:task.id},descendantCounts:counts,total:all.length,imageNodes:all.filter(n=>"fills" in n&&Array.isArray(n.fills)&&n.fills.some(f=>f.type==="IMAGE")).map(n=>({id:n.id,name:n.name,width:n.width,height:n.height})),fontFamilies:[...new Set(all.filter(n=>n.type==="TEXT").flatMap(n=>n.getStyledTextSegments(["fontName"]).map(s=>s.fontName.family)))]};
