import { ArrowRight, ImageIcon, Plus } from "lucide-react";
import { getStrings, type Locale } from "../i18n";
import { Banner, Button, Card, Chip } from "../ui";

export interface HomeScreenProps {
  locale: Locale;
  /** True once the local project has walls (a captured plan). */
  captured: boolean;
  onStart: () => void;
  onContinue: () => void;
  onNewProject: () => void;
}

/** One local project; no project backend (UI_PORT_PLAN phase 2). */
export function HomeScreen({ locale, captured, onStart, onContinue, onNewProject }: HomeScreenProps) {
  const t = getStrings(locale);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background font-sans" data-testid="home-screen">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <h1 className="px-1 pt-1 text-2xl font-extrabold">{t["home.title"]}</h1>
        <Card className="overflow-hidden border-foreground p-0">
          <div className="relative flex h-40 items-center justify-center border-b-2 border-foreground bg-muted">
            <ImageIcon className="size-12 text-muted-foreground" aria-label={t["home.thumb"]} />
            <Chip tone="neutral" className="absolute left-2 top-2 bg-foreground text-background">
              {captured ? t["home.captured"] : t["home.draft"]}
            </Chip>
          </div>
          <div className="space-y-1 p-3">
            <h2 className="text-xl font-extrabold">{t["project.defaultName"]}</h2>
            <p className="text-[15px] text-muted-foreground">
              {t["home.place"]} · {captured ? t["home.captured"] : t["home.noPlan"]}
            </p>
          </div>
          <div className="p-3 pt-0">
            <Button className="w-full" onClick={captured ? onContinue : onStart}>
              {captured ? t["home.continue"] : t["home.start"]} <ArrowRight className="size-6" aria-hidden />
            </Button>
          </div>
        </Card>
        <Banner tone="info" title={t["home.offline.title"]}>
          {t["home.offline.body"]}
        </Banner>
      </div>
      <div className="shrink-0 border-t-2 border-foreground bg-card p-3">
        <Button variant="secondary" className="w-full" onClick={onNewProject}>
          <Plus className="size-6" aria-hidden /> {t["home.new"]}
        </Button>
      </div>
    </div>
  );
}
