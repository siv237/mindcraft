import net from 'net';
import dgram from 'dgram';
import mc from 'minecraft-protocol';

/**
 * Discovers a Minecraft LAN server via UDP multicast.
 * Minecraft "Open to LAN" broadcasts [MOTD]...[/MOTD][AD]PORT[/AD] to 224.0.2.60:4445.
 * @param {number} timeout - How long to listen for broadcasts (ms).
 * @returns {Promise<{host: string, port: number, motd: string}>} - Server info from multicast.
 */
export function discoverLanServer(timeout = 10000) {
    return new Promise((resolve, reject) => {
        const MULTICAST_ADDR = '224.0.2.60';
        const MULTICAST_PORT = 4445;

        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                try { socket.dropMembership(MULTICAST_ADDR); } catch {}
                socket.close();
            }
        };

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`No Minecraft LAN server discovered within ${timeout}ms. Make sure the world is open to LAN.`));
        }, timeout);

        socket.on('message', (msg, rinfo) => {
            const text = msg.toString('utf8');
            const portMatch = text.match(/\[AD\](\d+)\[\/AD\]/);
            const motdMatch = text.match(/\[MOTD\](.*?)\[\/MOTD\]/);
            if (portMatch) {
                const port = parseInt(portMatch[1], 10);
                const motd = motdMatch ? motdMatch[1] : 'Unknown';
                const host = rinfo.address;
                console.log(`LAN server discovered via multicast: ${host}:${port} (${motd})`);
                resolved = true;
                clearTimeout(timer);
                cleanup();
                resolve({ host, port, motd });
            }
        });

        socket.on('error', (err) => {
            cleanup();
            clearTimeout(timer);
            reject(new Error(`Multicast discovery error: ${err.message}`));
        });

        socket.bind(MULTICAST_PORT, () => {
            socket.addMembership(MULTICAST_ADDR);
            socket.setBroadcast(true);
            console.log(`Listening for Minecraft LAN broadcasts on ${MULTICAST_ADDR}:${MULTICAST_PORT}...`);
        });
    });
}

/**
 * Pings a Minecraft server and collects its info.
 * @param {string} ip - The IP address to scan.
 * @param {number} port - The port to check.
 * @param {number} timeout - The connection timeout in ms.
 * @param {boolean} verbose - Whether to print output on connection errors.
 * @returns {Promise<Array>} - A Promise that resolves to an array of server info objects.
 */
export async function serverInfo(ip, port, timeout = 1000, verbose = false) {
    return new Promise((resolve) => {

        let timeoutId = setTimeout(() => {
            if (verbose)
                console.error(`Timeout pinging server ${ip}:${port}`);
            resolve(null); // Resolve as null if no response within timeout
        }, timeout);

        mc.ping({
            host: ip,
            port
        }, (err, response) => {
            clearTimeout(timeoutId);

            if (err) {
                if (verbose)
                    console.error(`Error pinging server ${ip}:${port}`, err);
                return resolve(null);
            }

            // extract version number from modded servers like "Paper 1.21.4"
            const version = response?.version?.name || '';
            const match = String(version).match(/\d+\.\d+(?:\.\d+)?/);
            const numericVersion = match ? match[0] : null;
            if (numericVersion !== version) {
                console.log(`Modded server found (${version}), attempting to use ${numericVersion}...`);
            }

            const serverInfo = {
                host: ip,
                port,
                name: response.description.text || 'No description provided.',
                ping: response.latency,
                version: numericVersion
            };

            resolve(serverInfo);
        });
    });
}

/**
 * Scans the IP address for Minecraft LAN servers and collects their info.
 * @param {string} ip - The IP address to scan.
 * @param {boolean} earlyExit - Whether to exit early after finding a server.
 * @param {number} timeout - The connection timeout in ms.
 * @returns {Promise<Array>} - A Promise that resolves to an array of server info objects.
 */
export async function findServers(ip, earlyExit = false, timeout = 100) {
    const servers = [];
    const startPort = 49000;
    const endPort = 65000;

    const checkPort = (port) => {
        return new Promise((resolve) => {
            const socket = net.createConnection({ host: ip, port, timeout }, () => {
                socket.end();
                resolve(port); // Port is open
            });

            socket.on('error', () => resolve(null)); // Port is closed
            socket.on('timeout', () => {
                socket.destroy();
                resolve(null);
            });
        });
    };

    // This supresses a lot of annoying console output from the mc library
    // TODO: find a better way to do this, it supresses other useful output
    const originalConsoleLog = console.log;
    console.log = () => { };
    
    for (let port = startPort; port <= endPort; port++) {
        const openPort = await checkPort(port);
        if (openPort) {
            const server = await serverInfo(ip, port, 200, false);
            if (server) {
                servers.push(server);

                if (earlyExit) break;
            }
        }
    }

    // Restore console output
    console.log = originalConsoleLog;

    return servers;
}

/**
 * Gets the MC server info from the host and port.
 * @param {string} host - The host to search for.
 * @param {number} port - The port to search for.
 * @param {string} version - The version to search for.
 * @returns {Promise<Object>} - A Promise that resolves to the server info object.
 */
export async function getServer(host, port, version) {
    let server = null;
    let serverString = "";
    let serverVersion = "";

    // Auto-discover server via multicast when host is "auto"
    if (host === 'auto' || (port === -1 && (host === 'localhost' || host === '0.0.0.0' || !host)))
    {
        console.log(`Auto-discovering Minecraft LAN server via multicast...`);
        const discovered = await discoverLanServer(10000);
        host = discovered.host;
        port = discovered.port;
        console.log(`Discovered server at ${host}:${port}`);
        server = await serverInfo(host, port, 2000, true);
    }
    // Search for server
    else if (port == -1)
    {
        console.log(`No port provided. Searching for LAN server on host ${host}...`);
        
        await findServers(host, true).then((servers) => {
            if (servers.length > 0)
                server = servers[0];
        });

        if (server == null)
            throw new Error(`No server found on LAN.`);
    }
    else
        server = await serverInfo(host, port, 1000, true);

    // Server not found
    if (server == null) 
        throw new Error(`MC server not found. (Host: ${host}, Port: ${port}) Check the host and port in settings.js, and ensure the server is running and open to public or LAN.`);

    serverString = `(Host: ${server.host}, Port: ${server.port}, Version: ${server.version})`;

    if (version === "auto") 
        serverVersion = server.version;
    else
        serverVersion = version;
    // Server version unsupported / mismatch
    const isSupported = mc.supportedVersions.some(v => 
        serverVersion === v || (serverVersion.startsWith(v) && serverVersion.charAt(v.length) === '.')
    ); // Checks version or parent version (e.g. if 1.7 is supported then 1.7.2 will be allowed)
     if (!isSupported)
        throw new Error(`MC server was found ${serverString}, but version is unsupported. Supported versions are: ${mc.supportedVersions.join(", ")}.`);
    else if (version !== "auto" && server.version !== version)
        throw new Error(`MC server was found ${serverString}, but version is incorrect. Expected ${version}, but found ${server.version}. Check the server version in settings.js.`);
    else
        console.log(`MC server found. ${serverString}`);

    return server;
}
