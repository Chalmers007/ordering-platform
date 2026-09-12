'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteModifier,
  deleteModifierGroup,
  saveModifier,
  saveModifierGroup,
} from '@/app/(kds)/app/(dashboard)/menu/actions';
import type { MenuModifier, MenuModifierGroup } from '@/types/database';

type Group = MenuModifierGroup & { menu_modifiers: MenuModifier[] };

export function ModifierManager({ groups }: { groups: Group[] }) {
  const [pending, startTransition] = useTransition();
  const [groupName, setGroupName] = useState('');
  const [optionDraft, setOptionDraft] = useState<Record<string, string>>({});

  function createGroup() {
    startTransition(async () => {
      const result = await saveModifierGroup({ name: groupName, selectionType: 'single', isRequired: false, minSelections: 0, maxSelections: 1 });
      if (!result.ok) { toast.error(result.error); return; }
      setGroupName(''); toast.success('Option group added');
    });
  }

  function editGroup(group: Group) {
    const name = window.prompt('Group name', group.name)?.trim();
    if (!name) return;
    const selectionType = window.prompt('Selection type: single or multiple', group.selection_type);
    if (selectionType !== 'single' && selectionType !== 'multiple') return toast.error('Selection type must be single or multiple');
    const isRequired = window.confirm('Should an option be required?');
    startTransition(async () => {
      const result = await saveModifierGroup({ id: group.id, name, description: group.description ?? '', selectionType, isRequired, minSelections: isRequired ? 1 : 0, maxSelections: selectionType === 'single' ? 1 : group.max_selections });
      if (!result.ok) toast.error(result.error); else toast.success('Option group saved');
    });
  }

  function addOption(groupId: string) {
    const name = optionDraft[groupId]?.trim();
    if (!name) return;
    const price = window.prompt('Price adjustment in dollars (optional)', '0');
    if (price === null || !Number.isFinite(Number(price))) return toast.error('Enter a valid price adjustment');
    startTransition(async () => {
      const result = await saveModifier({ groupId, name, priceDeltaCents: Math.round(Number(price) * 100), isDefault: false, isAvailable: true });
      if (!result.ok) { toast.error(result.error); return; }
      setOptionDraft((draft) => ({ ...draft, [groupId]: '' })); toast.success('Option added');
    });
  }

  function editOption(groupId: string, option: MenuModifier) {
    const name = window.prompt('Option name', option.name)?.trim();
    if (!name) return;
    const price = window.prompt('Price adjustment in dollars (for example 1.50)', (option.price_delta_cents / 100).toFixed(2));
    if (price === null || !Number.isFinite(Number(price))) return toast.error('Enter a valid price adjustment');
    startTransition(async () => {
      const result = await saveModifier({ id: option.id, groupId, name, priceDeltaCents: Math.round(Number(price) * 100), isDefault: option.is_default, isAvailable: option.is_available });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success('Option saved');
    });
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-semibold text-neutral-100">Modifier groups and options</h2>
      <p className="mt-1 text-sm text-neutral-400">Create choices such as sizes, toppings, and sides, then attach groups to items above.</p>
      <div className="mt-3 flex gap-2">
        <Input className="border-neutral-700 bg-neutral-950 text-neutral-100" value={groupName} placeholder="New group, e.g. Toppings" onChange={(event) => setGroupName(event.target.value)} />
        <Button disabled={!groupName.trim()} loading={pending} onClick={createGroup}><Plus className="h-4 w-4" /> Add</Button>
      </div>
      <div className="mt-4 space-y-3">
        {groups.map((group) => (
          <div key={group.id} className="rounded-lg border border-neutral-800 p-3">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><p className="font-medium text-neutral-100">{group.name}</p><p className="text-xs text-neutral-500">{group.is_required ? 'Required' : 'Optional'} · {group.selection_type === 'single' ? 'single choice' : 'multiple choice'}</p></div>
                <Button size="icon" variant="ghost" aria-label={`Edit ${group.name}`} onClick={() => editGroup(group)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${group.name}`} onClick={() => startTransition(async () => { const result = await deleteModifierGroup(group.id); if (!result.ok) toast.error(result.error); })}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-neutral-300">
              {group.menu_modifiers.map((option) => <li key={option.id} className="flex items-center gap-2"><span className="flex-1">{option.name}</span><span className="text-xs text-neutral-500">{option.price_delta_cents >= 0 ? '+' : ''}{(option.price_delta_cents / 100).toFixed(2)}</span><Button size="icon" variant="ghost" aria-label={`Edit ${option.name}`} onClick={() => editOption(group.id, option)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" aria-label={`Delete ${option.name}`} onClick={() => startTransition(async () => { const result = await deleteModifier(option.id); if (!result.ok) toast.error(result.error); })}><Trash2 className="h-3.5 w-3.5" /></Button></li>)}
            </ul>
            <div className="mt-2 flex gap-2"><Input className="border-neutral-700 bg-neutral-950 text-neutral-100" value={optionDraft[group.id] ?? ''} placeholder="New option" onChange={(event) => setOptionDraft((draft) => ({ ...draft, [group.id]: event.target.value }))} /><Button size="sm" disabled={!optionDraft[group.id]?.trim()} onClick={() => addOption(group.id)}>Add option</Button></div>
          </div>
        ))}
      </div>
    </section>
  );
}
