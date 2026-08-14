import { CONDITION_LABEL } from '../lib/format';
import type { CopyCondition } from '../lib/supabase/types';

export function ConditionBadge({ condition }: { condition: CopyCondition }) {
  return <span className="condition-badge">{CONDITION_LABEL[condition]}</span>;
}
