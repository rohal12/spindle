/** A compiled-story-shaped HTML document for headless boot tests. */
export const STORY_HTML = `<!doctype html>
<html>
  <head><title>Headless</title></head>
  <body>
    <div id="root"></div>
    <tw-storydata name="Headless" startnode="1" ifid="HEADLESS-TEST" format="spindle" format-version="0.0.0">
      <style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">.x { color: red; }</style>
      <script role="script" id="twine-user-script" type="text/twine-javascript">Story.on('storyinit', function () { Story.set('booted', true); });</script>
      <tw-passagedata pid="1" name="Start" tags="">You wake up. {$gold} gold.
[[Hallway]]
{button "Find coin"}{set $gold = $gold + 1}{/button}</tw-passagedata>
      <tw-passagedata pid="2" name="Hallway" tags="">A long hallway. {if $gold &gt; 0}You are rich.{/if}
[[Back->Start]]</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$gold = 0
$booted = false</tw-passagedata>
    </tw-storydata>
    <script type="module">throw new Error('module scripts are not run headless');</script>
  </body>
</html>`;
