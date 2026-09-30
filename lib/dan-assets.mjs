import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Pin the original Mania Tracker artwork, without redistributing its files.
export const DAN_ASSET_HASHES = Object.freeze({
  "0.svg": "2442c7c5b0826ee012ac468acab11f4730bf4856518ea561fef1665340da1d44",
  "1.svg": "9f9719a4c181d21a6b7a296167e902447243d421e0c83da4777ee354159c059b",
  "10.svg": "f50c4f99a590d9487662d5b2bfaad6499602fcae727b415f05789742bce84283",
  "2.svg": "5d689af99bb9e686791f64861bd19e28878afecee20e39864f8e6d1faafdeeb9",
  "3.svg": "bd1e083252c3b75265d926ae3234ec1bc9ee81172ed7cfac84b839b72789f239",
  "4.svg": "af0b0053c30ad003f869c92f4a75db8355980ad702ed9df0091830de8dfc0850",
  "5.svg": "96a56b611fba4cac1a6400a357383f507924904f828d00d9ab092c7160260298",
  "6.svg": "8e04ee38a5315aa40b4c5267af66d8b30d31a015efabcc56e54d8d5a10f71eb3",
  "7.svg": "bbd1379ffc4ccf398ef1528ecb5921e9890ae8160443b58cddc7266b4f9c8595",
  "8.svg": "06c42097fa7339f90a7097876c9a3e23ed239396949eb968143812e4401a4c1e",
  "9.svg": "7a49447598d697e4df64103764e7aae19192d5fb5fc3986053ff063c18d4be8c",
  "azimuth.svg":
    "6b60c43b2f53146c6dd783e35d09b2fe68da961e2f9935d2d63ffa6d12cef6ba",
  "gamma.svg":
    "f24ad5e4ec450f70a3b2d238265166efed299fb22734b7a7f452a12a84bec94f",
  "ln-0.svg":
    "6cbdd7096690c3c1c3b9c7b1e0d313d5461f8a8521a99ce4e1df67a06a883af1",
  "ln-1.svg":
    "4f3efacc0917aaf5d07746f1f42124e51bfcfb22d3a63dac7b4780c9d565b4c1",
  "ln-10.svg":
    "3809305d5cfbe2fba0f8d354d6fffe25da4817cd3090f52619b6e16b5e6d7c7a",
  "ln-2.svg":
    "1a5139cf300f80ed66b93c7d4b667dc167fe44f2af27f7ca29031625e4db2c94",
  "ln-3.svg":
    "7988d2a41c139779da6c337b0f02eac6a6074a23304d956637cdd04dbcf5b3a5",
  "ln-4.svg":
    "35261caf3361749d9fccdbb8e459c00a6db08fc3a68e0cbdf68906855e1fb1b1",
  "ln-5.svg":
    "273f6ab2798ddb3ce03ed94d39405d30b019bd3ef7eba761a37eda83840f1559",
  "ln-6.svg":
    "e50324e61055c5adba92781908869980c039b6a0a361a118b303b31cab10f9a1",
  "ln-7.svg":
    "e41fce1e226de5e016ef336da322bdfc235c85a6796a537b9875d11514a786bb",
  "ln-8.svg":
    "58ce319bc0b22f7ff131d8098af8f92846fdcdd9a5e4f27cdada9644b3308331",
  "ln-9.svg":
    "db327723b1353889593738be9039cfabe09952306cbcae0fa567c2216b58d6d0",
  "ln-azimuth.svg":
    "4c6c8b07db7ad31bad6b4aa26018bc2909705f81552462a54cc183d0b2f7282c",
  "ln-gamma.svg":
    "82bb37db00aee2ba4e996a274f8bd3a395fbce73f50d1652215253324c55b3eb",
  "ln-stellium.svg":
    "7f433a5687302cf5b74c92de722c22b7d3034d71ca71707ed5b0026f2d24997f",
  "ln-zenith.svg":
    "f97dd147032f7102351f657c536b510b7b1b7e58b1324f6c96b3e65f536bfd1b",
  "stellium.svg":
    "da12760284c8309c5a98179b0b7d35a5304b095d3a4566ec0a3f15f04d592462",
  "zenith.svg":
    "e7637c33082e5ce281f3f875ff4654e26babaa428d6e8bce8932ef2772392df3",
});

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 64 * 1024;

export async function loadDanAsset(
  pathname,
  cache,
  { root, fetchAsset = fetch } = {},
) {
  const prefix = "/assets/dans/";
  if (!pathname.startsWith(prefix)) return null;
  const name = pathname.slice(prefix.length);
  if (!Object.hasOwn(DAN_ASSET_HASHES, name)) return null;
  const expected = DAN_ASSET_HASHES[name];
  const encoded = await cache.memo(
    `dan-svg-v1:${expected}`,
    Infinity,
    async () => {
      const local = await readFile(
        path.join(root, "public", "assets", "dans", name),
      ).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (local && digest(local) === expected) return local.toString("base64");
      const response = await fetchAsset(
        `https://mania-tracker.com/images/dans/7k/${name}`,
        {
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
      if (
        !response.ok ||
        !/^image\/svg\+xml(?:;|$)/i.test(
          response.headers.get("content-type") || "",
        )
      )
        throw new Error("The original Mania Tracker dan badge is unavailable.");
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES)
          throw new Error("The dan badge exceeds the size limit.");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (digest(bytes) !== expected)
        throw new Error(
          "Mania Tracker changed this dan badge. An application update is required.",
        );
      return bytes.toString("base64");
    },
  );
  const bytes = Buffer.from(encoded, "base64");
  if (digest(bytes) !== expected)
    throw new Error("The cached dan badge failed verification.");
  return bytes;
}
