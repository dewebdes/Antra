from mitmproxy import http
from mitmproxy.connection import Server
from mitmproxy.net.server_spec import ServerSpec
from mitmproxy import ctx
import urllib.parse

# List of 240 workers
WORKERS = [
    "shiny-fog-4f85.xxx-b64.workers.dev",
"winter-feather-e191.xxx.workers.dev",
"...other-240-workers..."
]

class headobj:
    def __init__(self, name, val):
        self.name = name
        self.val = val

class multiproxy:

    def __init__(self):
        self.num = 0

    def request(self, flow) -> None:
        self.num = self.num + 1
        if self.num > 240:
            self.num = 0

        print("http: " + flow.request.scheme)
        finalurl = "/?"
        finalurl += "dieuri=" + urllib.parse.quote_plus(flow.request.scheme + "://" + flow.request.host + flow.request.path) + "&diemet=" + flow.request.method
        print("\n\nFLOW: \n")
        print(flow.request)
        print("\n\n=============\n\n")

        headlist = []
        cookstr = ""
        for k, v in flow.request.headers.items():
            if k.upper() != "COOKIE":
                headlist.append(headobj(k.upper(), urllib.parse.quote_plus(v)))
            else:
                cookstr = urllib.parse.quote_plus(v)
        headstr = "nndd".join((str(x.name) + "nnpp" + str(x.val)) for x in headlist)
        dcok = cookstr if cookstr else "null"
        dbod = urllib.parse.quote_plus(flow.request.text) if flow.request.text else "null"

        finalurl += "&diehed=" + headstr + "&diecok=" + dcok + "&diebod=" + dbod
        print(finalurl)
        print("\n\n")

        # Select the worker based on the counter
        worker = WORKERS[self.num]
        print(f"Using worker: {worker}")

        # Modify the request
        flow.request.host = worker
        flow.request.path = finalurl
        flow.request.method = "GET"
        flow.request.port = 443
        flow.request.text = ""
        flow.request.scheme = "https"

        print(flow.request)

addons = [multiproxy()]