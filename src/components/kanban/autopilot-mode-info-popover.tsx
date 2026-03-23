'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export function AutopilotModeInfoPopover() {
  const t = useTranslations('kanban');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" side="bottom" align="end">
        <h4 className="font-medium mb-2">{t('autopilotInfoTitle')}</h4>
        <dl className="space-y-2">
          <div>
            <dt className="font-medium">{t('autopilotOff')}</dt>
            <dd className="text-muted-foreground">{t('autopilotInfoOff')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('autopilotAutonomous')}</dt>
            <dd className="text-muted-foreground">{t('autopilotInfoAutonomous')}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('autopilotAsk')}</dt>
            <dd className="text-muted-foreground">{t('autopilotInfoAsk')}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
