import { ApiError, database, operator, sameOrigin, body, json, failure } from '@/lib/tracker/server';
import { ACTIVE_ROW, areasRowId, courseRowId, parseAreas, parseGeometry, validSlug } from '@/lib/map/course-data';

const missingTable=(code?:string)=>code==='42P01'||code==='PGRST205';
function check(error:{code?:string}|null,message:string) {
  if(!error) return;
  if(missingTable(error.code)) throw new ApiError(503,'Aplique a migração tracker_courses no banco.');
  throw new ApiError(400,message);
}

/** Organization only: every stored course, the shared areas and the one shown live. */
export async function GET() {
  try {
    await operator();
    const {data,error}=await database().from('tracker_courses').select('id,data,updated_at').limit(200);
    check(error,'Não foi possível carregar as provas.');
    return json({rows:data??[]});
  } catch(error) { return failure(error); }
}

export async function POST(request:Request) {
  try {
    sameOrigin(request); await operator();
    const input=await body(request,262144);const db=database();
    if(!validSlug(input.venue) || !validSlug(input.course)) throw new ApiError(400,'Prova inválida.');
    const now=new Date().toISOString();
    if(input.action==='save') {
      // Geometry of this course and the event areas shared by every course of the venue.
      const geometry=parseGeometry(input.geometry),areas=input.areas==null?null:parseAreas(input.areas);
      if(!geometry || (input.areas!=null && !areas)) throw new ApiError(400,'Percurso inválido.');
      const rows=[{id:courseRowId(input.venue,input.course),data:geometry,updated_at:now},...(areas?[{id:areasRowId(input.venue),data:areas,updated_at:now}]:[])];
      const {error}=await db.from('tracker_courses').upsert(rows);
      check(error,'Não foi possível salvar o percurso.');
    } else if(input.action==='reset') {
      const {error}=await db.from('tracker_courses').delete().eq('id',courseRowId(input.venue,input.course));
      check(error,'Não foi possível restaurar o modelo.');
    } else if(input.action==='activate') {
      const {error}=await db.from('tracker_courses').upsert({id:ACTIVE_ROW,data:{venue:input.venue,course:input.course},updated_at:now});
      check(error,'Não foi possível publicar a prova.');
    } else throw new ApiError(400,'Ação inválida.');
    return json({ok:true,updatedAt:now});
  } catch(error) { return failure(error); }
}
