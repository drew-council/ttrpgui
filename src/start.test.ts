import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { lanAddresses, probeTargets, remember, serverUrl } from "./start.ts";

const net = (address: string, cidr: string, internal = false) =>
	({ family: "IPv4", address, cidr, internal }) as NetworkInterfaceInfo;

describe("lanAddresses", () => {
	test("keeps private LAN addresses and skips the rest", () => {
		expect(
			lanAddresses({
				lo: [net("127.0.0.1", "127.0.0.1/8", true)],
				enp5s0: [
					net("192.168.1.20", "192.168.1.20/24"),
					{
						...net("fe80::1", "fe80::1/64"),
						family: "IPv6",
					} as NetworkInterfaceInfo,
				],
				wlan0: [net("10.0.4.7", "10.0.4.7/16")],
				docker0: [net("172.17.0.1", "172.17.0.1/16")],
				"br-3f2a": [net("172.18.0.1", "172.18.0.1/16")],
				tailscale0: [net("100.101.1.2", "100.101.1.2/32")],
				wg0: [net("10.100.0.2", "10.100.0.2/24")],
				vpn: [net("10.8.0.6", "10.8.0.6/32")],
				eth1: [net("8.8.4.4", "8.8.4.4/24")],
			}),
		).toEqual(["192.168.1.20", "10.0.4.7"]);
	});
});

describe("probeTargets", () => {
	test("every host of each address's /24, once", () => {
		const targets = probeTargets(["192.168.1.20", "192.168.1.30", "10.0.4.7"]);
		expect(targets).toHaveLength(508);
		expect(targets[0]).toBe("192.168.1.1:7373");
		expect(targets[253]).toBe("192.168.1.254:7373");
		expect(targets[254]).toBe("10.0.4.1:7373");
	});
	test("none without an address", () => {
		expect(probeTargets([])).toEqual([]);
	});
});

describe("remember", () => {
	const key = (e: { dir: string }) => e.dir;
	test("puts the entry first and drops its older copy", () => {
		const list = [{ dir: "a" }, { dir: "b" }, { dir: "c" }];
		expect(remember(list, { dir: "c" }, key).map(key)).toEqual(["c", "a", "b"]);
	});
	test("keeps at most max", () => {
		const list = [{ dir: "a" }, { dir: "b" }];
		expect(remember(list, { dir: "n" }, key, 2).map(key)).toEqual(["n", "a"]);
	});
});

describe("serverUrl", () => {
	test("adds the scheme and the default port", () => {
		expect(serverUrl("igneous")).toBe("http://igneous:7373");
		expect(serverUrl(" 192.168.1.20:8000 ")).toBe("http://192.168.1.20:8000");
		expect(serverUrl("http://igneous:7373/control/")).toBe(
			"http://igneous:7373",
		);
	});
	test("refuses what is not an address", () => {
		expect(() => serverUrl("not an address")).toThrow("That is not an address");
		expect(() => serverUrl("http://")).toThrow("That is not an address");
	});
});
