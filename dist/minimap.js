export function visibleWorld(viewport, canvas) {
  return { x:-viewport.x/viewport.zoom, y:-viewport.y/viewport.zoom, width:canvas.width/viewport.zoom, height:canvas.height/viewport.zoom };
}

// The same transform drives drawing and navigation. Include the camera as well
// as the objects, so the viewport remains visible even far from the content.
export function minimapGeometry(cards, viewport, canvas, size) {
  const visible=visibleWorld(viewport,canvas);
  let minX=visible.x,minY=visible.y,maxX=visible.x+visible.width,maxY=visible.y+visible.height;
  for(const card of cards){minX=Math.min(minX,card.x);minY=Math.min(minY,card.y);maxX=Math.max(maxX,card.x+card.width);maxY=Math.max(maxY,card.y+card.height);}
  const marginX=Math.max(30,(maxX-minX)*.08),marginY=Math.max(30,(maxY-minY)*.08);
  minX-=marginX;maxX+=marginX;minY-=marginY;maxY+=marginY;
  const width=Math.max(1,size.width),height=Math.max(1,size.height),padding=Math.min(10,width/5,height/5);
  const scale=Math.min((width-2*padding)/(maxX-minX),(height-2*padding)/(maxY-minY));
  return { width,height,scale,offsetX:(width-(maxX-minX)*scale)/2-minX*scale,offsetY:(height-(maxY-minY)*scale)/2-minY*scale,minX,minY,maxX,maxY };
}
export const worldToMinimap=(point,g)=>({x:point.x*g.scale+g.offsetX,y:point.y*g.scale+g.offsetY});
export const minimapToWorld=(point,g)=>({x:(point.x-g.offsetX)/g.scale,y:(point.y-g.offsetY)/g.scale});
export const centerCamera=(point,viewport,canvas)=>({x:canvas.width/2-point.x*viewport.zoom,y:canvas.height/2-point.y*viewport.zoom});
export const dragCamera=(point,grab,viewport)=>({x:-(point.x-grab.x)*viewport.zoom,y:-(point.y-grab.y)*viewport.zoom});

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createMinimap({element,getCards,getViewport,getCanvasSize,onNavigate,onCommit,onFit,onZoom,onPrepare,onDismiss}) {
  const svg=element.querySelector('#minimap-svg'),toggle=element.querySelector('[data-map-toggle]'),zoomLabel=element.querySelector('[data-map-zoom]'),footer=element.querySelector('.minimap-footer');
  let geometry=null,gesture=null,expanded=false,pinned=false,hovered=false,keyboardFocus=false,pointerFocus=false,disposed=false;
  const cleanup=[];
  const listen=(target,type,listener,options)=>{target.addEventListener(type,listener,options);cleanup.push(()=>target.removeEventListener(type,listener,options));};
  svg.innerHTML='<g class="minimap-objects"></g><rect class="minimap-viewport" rx="3"/><text class="minimap-view-label" aria-hidden="true">Vista attuale</text>';
  const objects=svg.querySelector('.minimap-objects'),viewRect=svg.querySelector('.minimap-viewport'),viewLabel=svg.querySelector('.minimap-view-label');
  const setExpanded=value=>{
    expanded=value;element.classList.toggle('is-expanded',value);toggle.setAttribute('aria-expanded',value);
    toggle.setAttribute('aria-label',value?'Riduci minimappa':'Espandi minimappa');toggle.title=value?'Riduci minimappa':'Espandi minimappa';
  };
  function render(){
    if(disposed||!svg.isConnected||!svg.clientWidth||!svg.clientHeight)return;
    const cards=getCards(),viewport=getViewport(),canvas=getCanvasSize();
    geometry=gesture?.geometry||minimapGeometry(cards,viewport,canvas,{width:svg.clientWidth,height:svg.clientHeight});
    const g=geometry;
    svg.setAttribute('viewBox',`0 0 ${g.width} ${g.height}`);
    const markup=cards.map(card=>{
      const p=worldToMinimap(card,g),w=Math.max(2,card.width*g.scale),h=Math.max(2,card.height*g.scale);
      if(card.type==='text'&&!card.textBackground)return `<path d="M${p.x} ${p.y+1}h${w*.92}m-${w*.92} 3h${w*.62}" stroke="${escape(card.textColor||'#727e66')}" stroke-width="1.3" opacity=".85" fill="none"/>`;
      return `<rect x="${p.x}" y="${p.y}" width="${w}" height="${h}" rx="2" fill="${escape(card.color||'#fff')}" stroke="#b9c2ae" stroke-width=".6"/>`;
    }).join('');
    if(objects.innerHTML!==markup)objects.innerHTML=markup;
    const visible=visibleWorld(viewport,canvas),p=worldToMinimap(visible,g),width=visible.width*g.scale,height=visible.height*g.scale;
    for(const [key,value]of Object.entries({x:p.x,y:p.y,width,height}))viewRect.setAttribute(key,value);
    viewLabel.setAttribute('x',p.x+6);viewLabel.setAttribute('y',p.y+13);viewLabel.style.display=expanded&&width>85&&height>28?'':'none';
    zoomLabel.textContent=`${Math.round(viewport.zoom*100)}%`;
  }
  function pointerWorld(e,g){
    const matrix=svg.getScreenCTM();if(!matrix)return null;
    const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
    return minimapToWorld(point,g);
  }
  function navigate(position){onNavigate(position);}
  function releaseGesture(cancel=false){
    if(!gesture)return;
    const state=gesture;gesture=null;
    if(!cancel&&!state.moved&&state.inside)navigate(centerCamera(state.lastPoint,getViewport(),getCanvasSize()));
    if(svg.hasPointerCapture(state.pointerId))svg.releasePointerCapture(state.pointerId);
    element.classList.remove('is-dragging');element.style.removeProperty('width');element.style.removeProperty('height');
    footer.style.removeProperty('height');footer.style.removeProperty('transition');
    if(!hovered&&!pinned&&!keyboardFocus)setExpanded(false);
    render();onCommit();
  }
  listen(svg,'pointerdown',e=>{
    if(e.button!==0||gesture)return;
    e.preventDefault();e.stopPropagation();pointerFocus=true;keyboardFocus=false;onPrepare?.();
    if(e.pointerType==='touch'&&!expanded){pinned=true;setExpanded(true);return;}
    const rect=element.getBoundingClientRect();
    const footerHeight=footer.getBoundingClientRect().height;
    footer.style.transition='none';footer.style.height=`${footerHeight}px`;
    element.style.width=`${rect.width}px`;element.style.height=`${rect.height}px`;element.classList.add('is-dragging');
    render();
    const point=pointerWorld(e,geometry);if(!point){element.classList.remove('is-dragging');element.style.removeProperty('width');element.style.removeProperty('height');footer.style.removeProperty('height');footer.style.removeProperty('transition');return;}
    const visible=visibleWorld(getViewport(),getCanvasSize());
    const inside=point.x>=visible.x&&point.x<=visible.x+visible.width&&point.y>=visible.y&&point.y<=visible.y+visible.height;
    gesture={pointerId:e.pointerId,geometry,inside,startX:e.clientX,startY:e.clientY,moved:false,lastPoint:point,grab:inside?{x:point.x-visible.x,y:point.y-visible.y}:{x:visible.width/2,y:visible.height/2}};
    if(!inside)navigate(centerCamera(point,getViewport(),getCanvasSize()));
    svg.focus({preventScroll:true});svg.setPointerCapture(e.pointerId);
  });
  listen(svg,'pointermove',e=>{
    if(!gesture||e.pointerId!==gesture.pointerId)return;
    e.preventDefault();
    const point=pointerWorld(e,gesture.geometry);if(!point)return;
    gesture.lastPoint=point;
    if(!gesture.moved&&Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<3)return;
    gesture.moved=true;navigate(dragCamera(point,gesture.grab,getViewport()));
  });
  listen(svg,'pointerup',e=>{if(gesture?.pointerId===e.pointerId)releaseGesture();});
  listen(svg,'pointercancel',()=>releaseGesture(true));
  listen(svg,'lostpointercapture',()=>releaseGesture(true));
  listen(element,'pointerenter',e=>{if(e.pointerType!=='touch'){hovered=true;setExpanded(true);}});
  listen(element,'pointerleave',()=>{hovered=false;if(!pinned&&!keyboardFocus&&!gesture)setExpanded(false);});
  listen(element,'pointerdown',()=>{pointerFocus=true;keyboardFocus=false;});
  listen(document,'keydown',()=>{pointerFocus=false;},true);
  listen(element,'focusin',()=>{if(!pointerFocus){keyboardFocus=true;setExpanded(true);}});
  listen(element,'focusout',e=>{if(!element.contains(e.relatedTarget)){keyboardFocus=false;if(!hovered&&!pinned&&!gesture)setExpanded(false);}});
  listen(toggle,'click',e=>{e.stopPropagation();pinned=!expanded;keyboardFocus=false;setExpanded(pinned);});
  listen(element,'click',e=>{
    const action=e.target.closest('[data-map-action]')?.dataset.mapAction;if(!action)return;
    e.stopPropagation();onPrepare?.();if(action==='fit')onFit();else onZoom(action==='in'?1.2:1/1.2);
  });
  listen(element,'keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();releaseGesture(true);pinned=false;keyboardFocus=false;hovered=false;setExpanded(false);onDismiss?.();return;}
    if(e.target!==svg)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();keyboardFocus=true;setExpanded(true);onPrepare?.();
      const viewport=getViewport(),canvas=getCanvasSize(),step=e.shiftKey ? .5 : .15;
      navigate({x:viewport.x+(e.key==='ArrowLeft'?canvas.width*step:e.key==='ArrowRight'?-canvas.width*step:0),y:viewport.y+(e.key==='ArrowUp'?canvas.height*step:e.key==='ArrowDown'?-canvas.height*step:0)});onCommit();
    }else if(e.key==='Enter'||e.key.toLowerCase()==='f'){e.preventDefault();onFit();}
    else if(['+','=','-'].includes(e.key)){e.preventDefault();onZoom(e.key==='-'?1/1.2:1.2);}
  });
  listen(element,'wheel',e=>{e.preventDefault();e.stopPropagation();if(!gesture)onZoom(Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.003));},{passive:false});
  listen(window,'blur',()=>releaseGesture(true));
  listen(window,'resize',()=>{releaseGesture(true);render();});
  const observer=new ResizeObserver(()=>render());observer.observe(svg);
  setExpanded(false);render();
  return {render,dispose(){disposed=true;if(gesture)onCommit();gesture=null;observer.disconnect();cleanup.forEach(fn=>fn());}};
}
