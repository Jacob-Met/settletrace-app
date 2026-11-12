(()=>{
 const panel=document.getElementById('startup-status'),shell=document.querySelector('.shell'),heading=document.getElementById('startup-heading'),message=document.getElementById('startup-message'),retry=document.getElementById('startup-retry');
 let ready=false;
 const show=slow=>{if(ready)return;if(!slow)clearTimeout(timer);heading.textContent=slow?'Workspace is taking longer to load':'Could not open workspace';message.textContent=slow?'You can wait a little longer or reload the workspace.':'Reload to try opening your saved investigations again.';panel.hidden=false;shell.inert=true;retry.focus({preventScroll:true});};
 const timer=setTimeout(()=>show(true),10000);
 retry.onclick=()=>location.reload();
 window.addEventListener('settletrace:ready',()=>{const restore=!panel.hidden;ready=true;clearTimeout(timer);panel.hidden=true;shell.inert=false;document.body.dataset.workspaceReady='true';if(restore)document.getElementById('review-heading')?.focus({preventScroll:true});});
 window.addEventListener('settletrace:load-failed',()=>show(false));
 window.addEventListener('error',event=>{if(event.target?.id==='workspace-module')show(false);},true);
})();
