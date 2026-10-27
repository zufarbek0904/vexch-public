<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Bottom-tab rules (max tabs, required Settings tab, URL-based active tab) live in `src/lib/navigation.ts` and are covered by `navigation.test.ts`; UI must call `normalizeNav/canAdd/canRemove` instead of re-implementing them, so limits stay in one place.
- Styling uses the Dark Liquid Glass tokens and `glass`/`glass-strong` utilities in `src/styles.css`; no raw color classes in components, to keep theming centralized.
