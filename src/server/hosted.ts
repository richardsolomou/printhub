export function hostedDeployment() {
  const configured = process.env.STLQUEST_HOSTED?.trim()
  return configured ? configured === 'true' : process.env.PRINTHUB_HOSTED === 'true'
}
