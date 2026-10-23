"""Reproduce row-label coordinates from native full-resolution PNGs; requires ffmpeg."""
from pathlib import Path
import json,subprocess
P=Path(__file__).parent
rows=[]
for route,row,span in [('connected',499,(110,800)),('fallback-controlled',499,(110,800)),('fallback-controlled',398,(380,1080))]:
 coords=[]
 for phase in ['before','after']:
  name=f'{route}-{row}-{phase}.png'
  raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(P/name),'-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
  assert len(raw)==1206*2622*3
  ys=[]
  for y in range(550,625):
   n=0
   for x in range(*span):
    r,g,b=raw[(y*1206+x)*3:(y*1206+x)*3+3]
    n+=(min(r,g,b)>160 and max(r,g,b)-min(r,g,b)<30) if row==499 else max(r,g,b)<80
   if n>10:ys.append(y)
  assert ys
  coords.append({'file':name,'label_top_pixel':ys[0],'label_top_point':ys[0]/3})
 rows.append({'route':route,'row_id':f'HISTORY_ANCHOR_{row}','offset_before_page_arrival_pt':coords[0]['label_top_point'],'offset_after_landing_pt':coords[1]['label_top_point'],'drift_pt':coords[1]['label_top_point']-coords[0]['label_top_point'],'captures':coords})
result={'coordinate_space':'Top of the first rendered label glyph, measured from top of native screenshot, in UIKit points (3 pixels/point). These are raster-measured row landmarks, not accessibility frame values or UIScrollView contentOffset. Before images show the pending-page spinner; after images show inserted older content.','native_receipts':'controlled-testMissingAnchorCallerRestoresReader.log and caller-testConnectedCallerConsumesDeferredOnce.log','rows':rows}
(P/'landing-trace.json').write_text(json.dumps(result,indent=2)+'\n')
for r in rows:print(r['route'],r['row_id'],r['offset_before_page_arrival_pt'],r['offset_after_landing_pt'],r['drift_pt'])
