export const VENUES = [
  {id:'imboassica', name:'DSB · Imboassica', lat:-22.414654, lon:-41.818751},
  {id:'vitoria-test', name:'Teste · Vitória', lat:-20.265221, lon:-40.260797},
] as const;
export type VenueId = typeof VENUES[number]['id'];
export const venueById = (id?: string) => VENUES.find(v=>v.id===id) ?? VENUES[0];
export const emptyCourse = () => ({buoys:[],routes:[],finishLine:{p1:null,p2:null},maintenanceArea:[],waitingArea:[]});
