export class UploadValidationError extends Error {}
export function validateUpload(name:string,_claimedType:string,bytes:Uint8Array){
 if(!bytes.length||bytes.length>10*1024*1024)throw new UploadValidationError('Choose a file between 1 byte and 10 MB.');
 const fileName=name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(-180)||'attachment';
 const extension=fileName.split('.').at(-1)?.toLowerCase();
 let mimeType='';let textContent='';
 if(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')mimeType='application/pdf';
 else if(extension==='png'&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))mimeType='image/png';
 else if(['jpg','jpeg'].includes(extension||'')&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mimeType='image/jpeg';
 else if(['txt','csv','json','eml'].includes(extension||'')){
  if(bytes.includes(0))throw new UploadValidationError('This text file contains binary data.');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new UploadValidationError('Text evidence must use UTF-8 encoding.');}
  if(extension==='json'){try{JSON.parse(text);}catch{throw new UploadValidationError('The JSON attachment is not valid JSON.');}}
  mimeType=extension==='json'?'application/json':extension==='csv'?'text/csv':extension==='eml'?'message/rfc822':'text/plain';
  textContent=text.slice(0,24000)+(text.length>24000?'\n[Text preview truncated. Review the attached original.]':'');
 }
 if(!mimeType)throw new UploadValidationError('Use PDF, PNG, JPEG, UTF-8 text, CSV, JSON, or EML evidence.');
 return {fileName,mimeType,textContent};
}
