import { defineConfig } from 'wxt';

// Public half of the RSA keypair that pins the Chrome extension ID to
// godlpcbbbcibenblemaffmgpolkjobgp. The private key lives outside the repo
// (see README "Extension IDs and OAuth redirect URLs").
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvSt6uozlxdEpZ1lJKNy5LtK6PyXdXbB2ONqDW4eLi96qviNo52aGzoZ66j1Q7X0w5JcCxqKP538nAQBrmhB9pWotSB36Hfh6638sdGxFPVIDhY0BQqOhQPNmNWIHIJOYWXJ5Qec+Nfx8feWfodrrnOmmiGLLn/ACzRPZpGay0sRCd6jl7UDuN/ZtDfi6rXUissb6KAL5tIzvE6LZvWnmTI2Py7qhG08Ntnts05qG6X+FJqGRKTqrbHWnRMzzQHPnM2Tcj/z8NvWAUrclpHXmof1u8Tlp1h5Rw54YbqxtSR0PPAmLokL5ykY9mMT+wQyIBuaLbQyZFZVam4MLHtezZwIDAQAB';

const FIREFOX_ID = 'd2-loadoutgpt@naifen.github.io';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'd2-loadoutGPT',
    description: 'Destiny 2 loadout assistant',
    action: { default_title: 'd2-loadoutGPT' },
    permissions: ['identity', 'storage'],
    host_permissions: ['https://www.bungie.net/*'],
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: FIREFOX_ID } } }
      : { key: CHROME_KEY }),
  }),
});
