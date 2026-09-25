<?php

namespace Tests\Feature;

use App\Models\Challenge;
use App\Models\User;
use App\Toolmark\ServerTool;
use App\Toolmark\ToolmarkProps;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** Spec §12.4: the `toolmark` prop holds only tools the current user may run. */
final class PropsBuilderTest extends TestCase
{
    use RefreshDatabase;

    public function test_props_builder_filters_by_authorization(): void
    {
        $alice = User::factory()->create(['email' => 'alice@example.test']);
        $bob = User::factory()->create(['email' => 'bob@example.test']);
        $challenge = Challenge::factory()->for($alice)->create();

        $this->actingAs($alice)->get('/challenges')->assertInertia(fn (Assert $page) => $page
            ->component('challenges/index')
            ->has('toolmark', 1)
            ->where('toolmark.0.name', 'challenges.archive')
            ->where('toolmark.0.visit', ['url' => 'http://localhost/challenges/archive', 'method' => 'post'])
            ->where('toolmark.0.hints', ['destructive' => true, 'consequential' => true])
            ->where('toolmark.0.inputSchema.additionalProperties', false)
            ->where('toolmark.0.inputSchema.properties.challenge.enum', [$challenge->getKey()])
        );
        // Bob may archive nothing: the tool is not rendered for him at all.
        $this->actingAs($bob)->get('/challenges')->assertInertia(fn (Assert $page) => $page
            ->component('challenges/index')
            ->has('toolmark', 0)
        );

        // The route re-authorizes every visit: the prop is a hint, not a permission.
        $this->actingAs($bob)->post('/challenges/archive', ['challenge' => $challenge->getKey()])->assertForbidden();
        $this->assertNull($challenge->fresh()->archived_at);
        $this->actingAs($alice)->post('/challenges/archive', ['challenge' => $challenge->getKey()])->assertRedirect('/challenges');
        $this->assertNotNull($challenge->fresh()->archived_at);
        // Nothing left to archive: the tool disappears for Alice too.
        $this->actingAs($alice)->get('/challenges')->assertInertia(fn (Assert $page) => $page->has('toolmark', 0));
    }

    public function test_props_builder_rejects_misconfigured_tools_outside_production(): void
    {
        $alice = User::factory()->create();
        $request = Request::create('/challenges');
        $request->setUserResolver(fn () => $alice);

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('closed root schema');
        ToolmarkProps::for($request, [new ServerTool(
            name: 'challenges.archive',
            description: 'Archive one of the challenges listed on this page.',
            route: 'challenges.archive',
            routeParameters: [],
            method: 'post',
            inputSchema: ['type' => 'object', 'properties' => ['challenge' => ['type' => 'integer']]],
            ability: 'archiveAny',
            arguments: Challenge::class,
        )]);
    }
}
