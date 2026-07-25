import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterHoverCard } from '@/panels/macros/studio/FilterHoverCard';
import { VariableHoverCard } from '@/panels/macros/studio/VariableHoverCard';
import { buildSampleContext, MACRO_VARIABLES, resolvePath, structureOf } from '../../../src/shared/macros';

const variable = (name: string) => {
  const v = MACRO_VARIABLES.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name}`);
  return v;
};

const structureFor = (name: string) => {
  const r = resolvePath(structureOf(buildSampleContext()), [name]);
  return r.ok ? r.node : null;
};

describe('VariableHoverCard', () => {
  it('shows the name, type, availability and the untruncated description', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText('paths')).toBeTruthy();
    expect(screen.getByText(/reply only/i)).toBeTruthy();
    expect(screen.getByText(/repeaters between the sender and you/i)).toBeTruthy();
  });

  it('shows the example, which no other surface renders', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText(/default: "direct"/)).toBeTruthy();
  });

  it('lists the path fields and drills one level into hops', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText('hops')).toBeTruthy();
    expect(screen.getByText('all_hops')).toBeTruthy();
    // `short_id` appears under both hops and all_hops — the point is that a
    // one-level card would show neither.
    expect(screen.getAllByText('short_id').length).toBeGreaterThan(0);
  });

  it('marks a field the sample proves can be null', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getAllByText('string|null').length).toBeGreaterThan(0);
  });

  it('renders a scalar variable without a structure section', () => {
    render(<VariableHoverCard variable={variable('my_name')} structure={structureFor('my_name')} />);
    expect(screen.getByText('my_name')).toBeTruthy();
    expect(screen.queryByText(/^STRUCTURE$/i)).toBeNull();
  });
});

describe('FilterHoverCard', () => {
  it('shows signature and description, and the example when given', () => {
    render(
      <FilterHoverCard
        name="distance"
        description="Great-circle distance in metres between two positions"
        signature="{{ a | distance: b }}"
        example="{{ my_pos | distance: peer_pos }}"
      />,
    );
    expect(screen.getByText('distance')).toBeTruthy();
    expect(screen.getByText('{{ a | distance: b }}')).toBeTruthy();
    expect(screen.getByText('{{ my_pos | distance: peer_pos }}')).toBeTruthy();
  });

  it('omits the example section when there is none', () => {
    render(<FilterHoverCard name="first" description="First item of an array" signature="{{ array | first }}" />);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.queryByText(/^EXAMPLE$/i)).toBeNull();
  });
});
