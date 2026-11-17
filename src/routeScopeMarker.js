// Metadata only. Does not wrap, invoke, or install the tenant resolver.
export function scoped(handler) {
  Object.defineProperty(handler,'tenantScoped',{value:true});
  return handler;
}
