// Patch connected nodes in place. Replacing shadowRoot.innerHTML detached live
// cards and reset the scroll range on every poll; it also restarted map iframes.
export function patchPanel(root, markup) {
  const template=document.createElement('template');template.innerHTML=markup;
  const key=node=>node.nodeType===1?(node.getAttribute('data-f1-slot')||node.getAttribute('data-radar-id')||node.id||''):'';
  const same=(a,b)=>a&&a.nodeType===b.nodeType&&a.nodeName===b.nodeName&&key(a)===key(b);
  function patch(parent,fresh){
    const desired=[...fresh.childNodes];
    for(let i=0;i<desired.length;i++){
      const next=desired[i];let old=parent.childNodes[i];
      if(!same(old,next)){parent.insertBefore(next.cloneNode(true),old||null);continue;}
      if(old.nodeType!==1){if(old.nodeValue!==next.nodeValue)old.nodeValue=next.nodeValue;continue;}
      for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name)&&!(attr.name==='hidden'&&old.tagName==='IMG'&&old.getAttribute('src')===next.getAttribute('src')))old.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
      if(old.hasAttribute('data-f1-slot'))continue;
      if(old.tagName==='IFRAME')continue;
      patch(old,next);
      if(['INPUT','SELECT','TEXTAREA'].includes(old.tagName)&&old!==root.activeElement){old.value=next.value;if(old.type==='checkbox')old.checked=next.checked;}
    }
    while(parent.childNodes.length>desired.length)parent.lastChild.remove();
  }
  patch(root,template.content);
}
