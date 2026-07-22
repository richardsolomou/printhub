# Connect a local folder through Cloudflare Tunnel

This guide connects a WebDAV folder on your computer or NAS to a hosted STL Quest deployment without opening a port on your router. Cloudflare Tunnel makes the outbound connection and gives the folder a public HTTPS address; your WebDAV username and password protect the files at that address.

## Before you start

You need:

- A domain using Cloudflare DNS.
- A computer or NAS that stays online when STL Quest needs its files.
- A WebDAV server with a dedicated folder, username, and strong password for STL Quest. Many NAS products have a WebDAV app; follow the NAS vendor's instructions to enable it and restrict the account to that folder.
- The WebDAV address on your local network, such as `http://127.0.0.1:8080/dav` when WebDAV and `cloudflared` run on the same machine, or `https://192.168.1.20:5006/dav` when they run on different devices.

Check that the local address and credentials work before creating the tunnel. From a machine that can reach the WebDAV server, replace the example values and run:

```sh
curl --user 'stlquest:your-password' --request PROPFIND --header 'Depth: 0' --include http://127.0.0.1:8080/dav/
```

A working WebDAV server normally returns `207 Multi-Status`. A `401` response means the credentials are wrong; `404` or `405` usually means the URL does not point to the WebDAV endpoint.

## Create the tunnel

1. Open the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/), then go to **Networks → Connectors → Cloudflare Tunnels** and choose **Create a tunnel**. Cloudflare sometimes shortens this navigation to **Networks → Tunnels**.
2. Choose **Cloudflared**, name the tunnel (for example, `stlquest-storage`), and save it.
3. Select the operating system of the computer or NAS that will run the connector. Copy and run the installation command Cloudflare displays. It contains a tunnel token, so do not share or save that command in a public file.
4. Wait until the connector shows **Healthy**. If WebDAV runs on a NAS that cannot run `cloudflared`, install the connector on another always-on computer on the same private network.
5. Add a **Published application** or **Public hostname** to the tunnel. Choose a dedicated hostname such as `storage.example.com`.
6. Set the service type and URL to the local WebDAV address. Use `HTTP` with a loopback address when WebDAV and `cloudflared` are on the same machine. If the connector reaches a different device over the network, prefer `HTTPS` with a certificate the connector trusts.
7. Save the hostname. Cloudflare creates the DNS record and TLS certificate automatically; it may take a minute before the public address responds.

Cloudflare's [tunnel setup documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) has current installation steps for each supported operating system.

## Test the public address

Run the same check against the public hostname:

```sh
curl --user 'stlquest:your-password' --request PROPFIND --header 'Depth: 0' --include https://storage.example.com/dav/
```

Continue only after it returns `207 Multi-Status`. A Cloudflare `502` response means the connector cannot reach the local WebDAV address; check that the service URL uses the correct scheme, host, port, and path.

## Connect STL Quest

In **Settings → Storage**, choose **Remote folder (WebDAV)** and enter:

- **WebDAV endpoint:** the public URL, including the WebDAV path, such as `https://storage.example.com/dav`.
- **Folder:** a new folder below that endpoint, such as `stlquest`. STL Quest creates its workspace folders underneath it.
- **Username and password:** the dedicated WebDAV credentials you tested above.

Save the settings. STL Quest checks the connection before switching storage.

## Keep it safe and reliable

- Expose only WebDAV on this hostname. Do not route your NAS dashboard, router, SSH server, or other administration interface through it.
- Do not put a Cloudflare Access browser login in front of the hostname. STL Quest is a background service and cannot complete an interactive login; it authenticates directly with WebDAV instead.
- Restrict the WebDAV account to its dedicated folder and use a unique password. Anyone with the public URL and credentials can access that folder.
- Keep the connector, WebDAV server, and storage device running. STL Quest cannot upload, download, or move files while any of them is offline.
- Cloudflare limits the size of a single proxied upload. The documented limit is 100 MB on Free and Pro plans, 200 MB on Business, and 500+ MB on Enterprise. Files above your plan's limit cannot be stored through this tunnel; use another storage provider if your STL files exceed it. Check Cloudflare's [current upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#customization-options-and-limits).

To revoke access, delete the tunnel's public hostname in Cloudflare and rotate the dedicated WebDAV password.
