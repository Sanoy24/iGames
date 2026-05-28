import { ArrowLeft } from 'lucide-react';

export type GameTabOption<T extends string> = {
  id: T;
  label: string;
  description: string;
  icon?: React.ReactNode;
};

type GameTabsProps<T extends string> = {
  tabs: Array<GameTabOption<T>>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  onBack: () => void;
  ariaLabel: string;
  backLabel?: string;
};

export function GameTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  onBack,
  ariaLabel,
  backLabel = 'Games',
}: GameTabsProps<T>) {
  return (
    <div className="game-tabs-header">
      <button className="btn btn-ghost btn-sm page-back-button" onClick={onBack} type="button" title={backLabel}>
        <ArrowLeft size={16} />
        <span className="back-btn-text">{backLabel}</span>
      </button>

      <div className="game-tab-bar" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`game-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            title={tab.label}
          >
            {tab.icon && <div className="game-tab-icon">{tab.icon}</div>}
            <div className="game-tab-content">
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
