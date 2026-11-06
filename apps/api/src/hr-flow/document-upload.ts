/** Check the DOCX container without extracting or processing its content. */
export function isDocxPackage(bytes:Buffer):boolean {
  if(bytes.length<22||bytes.readUInt32LE(0)!==0x04034b50)return false;
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  }
  if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)return false;
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
  if(count<2||count>2000||bytes.readUInt16LE(end+8)!==count||offset+size!==end)return false;
  const names=new Set<string>();let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)return false;
    const length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),next=cursor+46+length+extra+comment;
    if(next>end||(bytes.readUInt16LE(cursor+8)&1)!==0||![0,8].includes(bytes.readUInt16LE(cursor+10)))return false;
    const name=bytes.subarray(cursor+46,cursor+46+length).toString('utf8');
    const local=bytes.readUInt32LE(cursor+42);
    if(local+30>offset||bytes.readUInt32LE(local)!==0x04034b50||name.startsWith('/')||name.includes('..')||names.has(name))return false;
    total+=bytes.readUInt32LE(cursor+24);if(total>100*1024*1024)return false;
    names.add(name);cursor=next;
  }
  return cursor===end&&names.has('[Content_Types].xml')&&names.has('word/document.xml');
}
