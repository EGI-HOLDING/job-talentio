import { randomBytes } from 'node:crypto';

const organization = 'urn:li:organization:9100001';
const person = 'urn:li:person:local-company-recruiter';

/** Only used by the explicit loopback package preview. No remote requests. */
export function simulateCompanyLinkedIn(url: URL, request: RequestInit): Response {
  const path = url.pathname;
  if (path === '/oauth/v2/accessToken' && request.body instanceof URLSearchParams && request.body.get('code') === 'talentio-local-company') {
    return Response.json({access_token: 'talentio-local-company-token', expires_in: 86400,
      scope: 'openid profile w_member_social w_organization_social r_organization_admin'});
  }
  if (path === '/v2/userinfo') return Response.json({sub: 'local-company-recruiter', name: 'HR Sandbox'});
  if (path === '/rest/organizationAcls') return Response.json({elements: [{organization, roleAssignee: person, role: 'ADMINISTRATOR', state: 'APPROVED'}]});
  if (path === '/rest/organizations/9100001') return Response.json({localizedName: 'Talentio Company Page Sandbox'});
  if (path === '/rest/images' && request.method === 'POST') {
    return Response.json({value: {uploadUrl: 'https://media.licdn.com/talentio-local-preview', uploadUrlExpiresAt: Date.now() + 60000,
      image: 'urn:li:image:talentio-local-preview'}});
  }
  if (path === '/talentio-local-preview' && request.method === 'PUT') return new Response(null, {status: 201});
  if (path.startsWith('/rest/images/')) return Response.json({status: 'AVAILABLE'});
  if (path === '/rest/posts' && request.method === 'POST' && typeof request.body === 'string' && JSON.parse(request.body).author === organization) {
    return new Response(null, {status: 201, headers: {'x-restli-id': 'urn:li:share:' + BigInt('0x' + randomBytes(8).toString('hex'))}});
  }
  return new Response(null, {status: 403});
}
