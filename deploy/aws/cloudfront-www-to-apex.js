function handler(event) {
  var request = event.request
  var host = request.headers.host && request.headers.host.value
  if (host === 'www.jeffistores.in') {
    var qs = ''
    if (request.querystring) {
      var parts = []
      for (var k in request.querystring) {
        var v = request.querystring[k]
        if (v.multiValue) {
          for (var i = 0; i < v.multiValue.length; i++) {
            parts.push(k + '=' + v.multiValue[i].value)
          }
        } else {
          parts.push(k + '=' + v.value)
        }
      }
      if (parts.length) qs = '?' + parts.join('&')
    }
    return {
      statusCode: 307,
      statusDescription: 'Temporary Redirect',
      headers: {
        location: { value: 'https://jeffistores.in' + request.uri + qs },
        'cache-control': { value: 'no-store, must-revalidate' },
        'clear-site-data': { value: '"cache"' },
      },
    }
  }
  return request
}
