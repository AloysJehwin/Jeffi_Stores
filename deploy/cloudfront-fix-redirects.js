function handler(event) {
  var response = event.response;
  var headers = response.headers;

  if (headers['location'] && headers['location'].value) {
    var loc = headers['location'].value;
    if (loc.indexOf(':3000') !== -1) {
      headers['location'] = { value: loc.replace(/:3000/g, '') };
    }
    if (loc.indexOf('www.jeffistores.in') !== -1) {
      headers['location'] = { value: headers['location'].value.replace(/www\.jeffistores\.in/g, 'jeffistores.in') };
    }
  }

  if (response.statusCode === 308) {
    response.statusCode = 307;
    response.statusDescription = 'Temporary Redirect';
  }

  if (response.statusCode === 301 || response.statusCode === 302 ||
      response.statusCode === 307 || response.statusCode === 308) {
    headers['cache-control'] = { value: 'no-store, must-revalidate' };
  }

  return response;
}
