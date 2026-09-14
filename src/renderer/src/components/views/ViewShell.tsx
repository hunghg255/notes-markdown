/** Shared frame for non-editor tabs (tasks, tags, search, graph). */
export function ViewShell({
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto flex flex-col gap-6 px-8 pt-16 pb-24 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  )
}
