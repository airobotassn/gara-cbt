from PIL import Image
L=['ko','en','ja','zh','hi','vi']
ims=[Image.open(f'tmp/_ft-{l}.png') for l in L]
w=sum(i.width for i in ims)+8*(len(ims)-1); h=max(i.height for i in ims)
out=Image.new('RGB',(w,h),(20,22,30)); x=0
for i in ims: out.paste(i,(x,0)); x+=i.width+8
out.save('tmp/_fe-table3.jpg',quality=88); print('tmp/_fe-table3.jpg',out.size)
