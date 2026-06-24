import { CheckIcon, CopyIcon } from '@radix-ui/react-icons';
import { DataList, Text } from '@radix-ui/themes';
import { useState } from 'react';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { Placeholder } from '../atoms';

const COPIED_TIMEOUT_MS = 1200;

export function VersionSection() {
  const capabilities = useStore((s) => s.capabilities);
  const [copied, setCopied] = useState(false);

  if (!capabilities) return <Placeholder label="loading…" />;

  const onCopySha = () => {
    void navigator.clipboard.writeText(capabilities.gitSha).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
    });
  };

  return (
    <DataList.Root orientation="horizontal" size="1">
      <KeyValueRow label="Version" value={capabilities.version} mono />
      <DataList.Item>
        <DataList.Label minWidth="0">
          <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
            Commit
          </Text>
        </DataList.Label>
        <DataList.Value>
          <button
            type="button"
            onClick={onCopySha}
            title={copied ? 'Copied' : 'Click to copy'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <Text
              size="1"
              style={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {capabilities.gitSha}
            </Text>
            {copied ? <CheckIcon width="12" height="12" aria-hidden /> : <CopyIcon width="12" height="12" aria-hidden />}
          </button>
        </DataList.Value>
      </DataList.Item>
      <KeyValueRow label="Electron" value={capabilities.electronVersion} mono />
      <KeyValueRow label="Platform" value={capabilities.platform} mono />
    </DataList.Root>
  );
}
