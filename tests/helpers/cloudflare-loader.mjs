// Unit tests run outside Workers. Storage tests must provide their own bindings;
// this shim is never imported by the application or included in its build.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return {
    url: "data:text/javascript," + encodeURIComponent("export const env = new Proxy({}, {get: (_, key) => globalThis.__testCloudflareEnv?.[key]});"),
    shortCircuit: true,
  };
  return nextResolve(specifier, context);
}
