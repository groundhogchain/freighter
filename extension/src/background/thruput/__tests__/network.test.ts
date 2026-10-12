import { requireThruputCompatibility } from "../network";

describe("Thruput RPC compatibility", () => {
  it.each(["11.1.0", "11.2.0"])(
    "accepts the qualified compatible wire family %s",
    async (wireFormat) => {
      const getVersion = jest.fn(async () => ({
        wireFormat,
        implementation: "fixture",
        platformVersion: null,
        commitHash: null,
        releaseVersion: null,
        bundleManifestDigest: null,
      }));
      await expect(
        requireThruputCompatibility({ getVersion }),
      ).resolves.toBeUndefined();
    },
  );
  it.each(["5.2.0", "12.0.0", "unknown"])(
    "rejects incompatible or unknown wire format %s",
    async (wireFormat) => {
      const getVersion = jest.fn(async () => ({
        wireFormat,
        implementation: "fixture",
        platformVersion: null,
        commitHash: null,
        releaseVersion: null,
        bundleManifestDigest: null,
      }));
      await expect(
        requireThruputCompatibility({ getVersion }),
      ).rejects.toMatchObject({ code: 4200 });
    },
  );
});
