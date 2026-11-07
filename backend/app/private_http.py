"""HTTP transport for requests carrying credentials or signed URLs."""

from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def private_opener():
    return build_opener(ProxyHandler({}), RejectRedirects())
