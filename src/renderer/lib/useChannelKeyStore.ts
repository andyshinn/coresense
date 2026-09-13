import { type CryptoKeyStore, MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { useMemo } from 'react';
import { useStore } from './store';

// Builds a decoder key store from every channel's secret so RF packet decode
// (rail + standalone decoder dialog) can attempt decryption. Memoized on
// `channels` — undefined when no channel has a secret, matching
// `inspectPacket`'s `opts?.keyStore` being optional.
export function useChannelKeyStore(): CryptoKeyStore | undefined {
  const channels = useStore((s) => s.channels);
  return useMemo(() => {
    const secrets = channels.map((c) => c.secretHex).filter((x): x is string => !!x);
    return secrets.length ? MeshCoreDecoder.createKeyStore({ channelSecrets: secrets }) : undefined;
  }, [channels]);
}
