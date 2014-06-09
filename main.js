//config
var capacity = 400;
var consumersCount = 1000;
var estimatePerSingleTable = 20;
var hoursOfService = 6;
var serviceMinUsage=15;
var serviceMaxUsage=25;
var predictionType=0;
var k = 0.5;
var displayByGroup = false;
var onlyWhoWaited = false;
var groups = undefined;

//internal
var waitingList = [],
estimatesPerTable={},
estimatesPerGroupSize={},
seatedClients=[],
_clients = {};

function reset(){
    waitingList = [];
    estimatesPerTable = {};
    estimatesPerGroupSize={};
    seatedClients=[];
    _clients = {};
}
function getClients(){
    return _clients;
}
function waitingTime(event, predictionType){
  var time=0, uid=event.uid;
  if(!_clients[uid]){
        _clients[uid] = {
            uid: uid,
            consumers : event.consumers,
            resources : getResourceCount(event.consumers),
            served : undefined
        };
  }
  var client = _clients[uid];
  if(client.status === event.status || client.status === undefined && event.status === 1){
    return -1;
  }
  client.status=event.status;
  //status = in
  if(client.status===0){
	client.checkin = event.timestamp;
	//served
	if(resourcesCount-client.resources>=0){
		seatClient(client,event.timestamp);
	}
	//has to wait
	else{
	    time = addClientToWaitingList(client, event.timestamp, predictionType);
	}
	client.estimatedWaitingTime = time;
  }
  //status = out
  else {
	client.checkout = event.timestamp;
    seatedClients.splice(seatedClients.indexOf(client),1);
	//walked away
	if(client.served === undefined){
		client.waitingTime = client.checkout - client.checkin;
		client.seatingTime = 0;
	}
	else{
    	resourcesCount+=client.resources;

		client.waitingTime = client.served - client.checkin;

		//how much time the service took
		client.seatingTime = client.checkout - client.served;

		//update estimate according to # of tables
		if(!estimatesPerTable[client.resources])
			estimatesPerTable[client.resources] = client.seatingTime;
		else
			estimatesPerTable[client.resources] = estimatesPerTable[client.resources] * (1-k) + client.seatingTime * k;
		//update estimate according to # of consumers
		if(!estimatesPerGroupSize[client.consumers])
			estimatesPerGroupSize[client.consumers] = client.seatingTime;
		else
			estimatesPerGroupSize[client.consumers] = estimatesPerGroupSize[client.consumers] * (1-k) + client.seatingTime * k;
		//single table avg waiting time
		estimatePerSingleTable = estimatePerSingleTable * (1-k) + (client.seatingTime/client.resources) * k;
	}
    client.waitingTimeError = client.waitingTime - client.estimatedWaitingTime;
    client.seatingTimeError = client.seatingTime - client.estimatedSeatingTime;
	//check if there are tables free for waiting people
	checkWaitingList(event.timestamp);
    time = client.waitingTime;
  }
  return time;
}

function checkWaitingList(timestamp){
    var aIndexes = [];
	for(var i=0,l=waitingList.length;i<l && resourcesCount > 0;i++){
		var client = waitingList[i];
		if(resourcesCount - client.resources >= 0){
			//if client is still waiting
			if(client.status===0){
				seatClient(client,timestamp);
			}
			aIndexes.push(i);
		}
	}
	for(var i=aIndexes.length-1;i>=0;i--){
        waitingList.splice(i,1);
	}
}

function getResourceCount(consumers){
	return Math.max(Math.floor(consumers/2),1);
}

function addClientToWaitingList(client, timestamp, predictionType){
    var estimate = 0, i = 0, j = 0, resourcesNeeded = 0;
    for(i=0,l=waitingList.length;i<l;i++){
        resourcesNeeded += waitingList[i].resources;
        for(j,ll=seatedClients.length;j<ll && resourcesNeeded>0;j++){
            var seatedClient = seatedClients[j];
            estimate += Math.max(seatedClient.served + seatedClient.estimatedSeatingTime - timestamp, 0);
            resourcesNeeded -= seatedClient.resources;
        }
    }
    if(estimate===0){
        estimate = estimatedSeatingTime(client, predictionType);
    }
    client.estimatedWaitingTime = estimate;
    waitingList.push(client);

    return estimate;
}

function estimatedSeatingTime(client, predictionType){
    var estimate = estimatePerSingleTable * client.resources;
    switch(predictionType){
        case 1:
            estimate = estimatesPerTable[client.resources] || estimate;
            break;
        case 2:
            estimate = estimatesPerTable[client.consumers] || estimate;
            break;
    }
    return estimate;
}

function seatClient(client, timestamp){
    resourcesCount -= client.resources;
    client.served = timestamp;
    //estimate in how much time they will finish eating
    client.estimatedSeatingTime = estimatedSeatingTime(client, predictionType);
    seatedClients.push(client);
    //order seatedClients to see who is about to go away
    seatedClients.sort(function(a,b){
        var tlA = a.served + a.estimatedSeatingTime - timestamp,
        tlB = b.served + b.estimatedSeatingTime - timestamp;
        return ((tlA<tlB) ? -1 : (tlA>tlB) ? 1 : 0);
    });
}












//Test

function readValues(){
    capacity = parseInt($("#capacity").val());
    consumersCount = parseInt($("#consumersCount").val());
    resourcesCount = getResourceCount(capacity);
    estimatePerSingleTable = parseInt($("#estimatePerSingleTable").val());
    hoursOfService = parseInt($("#hoursOfService").val());
    serviceMinUsage = parseInt($("#serviceMinUsage").val());
    serviceMaxUsage = parseInt($("#serviceMaxUsage").val());
    k = parseFloat($("#k").val());
    predictionType = parseInt($("#predictionType").val());
    displayByGroup = $("#displayByGroup")[0].checked;
    onlyWhoWaited = $("#onlyWhoWaited")[0].checked;
}

function simulate(newEvents){
	var nCapacity = parseInt($("#capacity").val());
	var nConsumersCount = parseInt($("#consumersCount").val());

    newEvents = newEvents || !groups || nCapacity !== capacity || nConsumersCount !== consumersCount;

    readValues();

	$("#ctrl").html("");
	start(newEvents, predictionType);
}

function changeDisplayByGroup(cb){
	displayByGroup = cb.checked;
	render();
}

function changeOnlyWhoWaited(cb){
	jQuery("#log").toggleClass("onlyWhoWaited", cb.checked);
}

function printHour(timestamp){
	var hours = Math.floor(timestamp/60);
	var time = hours + (timestamp - hours*60)/100;
	return time.toFixed(2).replace(".", ":");
}

function printMinute(timestamp){
	var ts = timestamp ? timestamp.toFixed(3) : 0;
	return parseFloat(ts) === timestamp ? timestamp : ts;
}

function start(newEvents, predictionType){
    if(newEvents){
        groups = generateGroups();
    	events = generateEvents(groups);
    }

	reset();

	for(var i=0,l=events.length;i<l;i++){
        var event = events[i];
        waitingTime(event, predictionType);
    }

	$("#ctrl").append("<br>estimatePerSingleTable " +estimatePerSingleTable+ "<br>");
	$("#ctrl").append("estimatesPerTable " +JSON.stringify(estimatesPerTable)+ "<br/>");
	$("#ctrl").append("estimatesPerGroupSize " +JSON.stringify(estimatesPerGroupSize));

	render();
}

function generateGroups(){
	var groups = [];
	var remainingPeople = consumersCount;
	while(remainingPeople>0){
		var i = groups.length;
		var consumers = Math.min(Math.floor(Math.random() * 4) + 1, remainingPeople);
		var tsStart = Math.floor(Math.random() * 60 * hoursOfService/2) + Math.floor(Math.random() * 60 * hoursOfService/2);
		var serviceUsage = serviceMinUsage + Math.floor(Math.random() * (serviceMaxUsage-serviceMinUsage));
		groups.push({
			uid: i,
			consumers: consumers,
			checkin: tsStart,
			serviceUsage: serviceUsage
		});
		remainingPeople-=consumers;
	}
	groups.sort(function(a,b){
		return ((a.checkin<b.checkin) ? -1 : (a.checkin>b.checkin) ? 1 : 0);
	});
	var totalCapacity = capacity;
	var queue = [];
	var seated = [];
	for(var i=0;i<groups.length;i++){
        var group = groups[i],
        ci = group.checkin;

		var aSeatedIndexes = [];
        //check if someone went away
        for(var j=0,l=seated.length;j<l;j++){
            var groupOut = seated[j],
            co = groupOut.checkout;
            if(co<=ci){
                totalCapacity += groupOut.consumers;
                console.log("checkout " + JSON.stringify(groupOut));
                aSeatedIndexes.push(j);
                //check the queue for someone to seat
                var aQueueIndexes = [];
                for(var k=0;k<queue.length && totalCapacity>0;k++){
                    var groupQueue = queue[k];
                    if(totalCapacity-groupQueue.consumers>=0){
                        totalCapacity -= groupQueue.consumers;
                        aQueueIndexes.push(k);
                        groupQueue.served = co;
                        groupQueue.checkout = co + groupQueue.serviceUsage;
                        console.log("served " + JSON.stringify(groupQueue));
                        seated.push(groupQueue);
                        seated.sort(function(a,b){
                            return ((a.checkout<b.checkout) ? -1 : (a.checkout>b.checkout) ? 1 : 0);
                        });
                    }
                }
                for(var k=aQueueIndexes.length-1; k>=0;k--){
                    queue.splice(aQueueIndexes[k],1);
                }
            }
        }
        for(var j=aSeatedIndexes.length-1; j>=0;j--){
            seated.splice(aSeatedIndexes[j],1);
        }

		if(totalCapacity-group.consumers>=0){
			totalCapacity -= group.consumers;
			group.served = ci;
			group.checkout = ci + group.serviceUsage;
			seated.push(group);
			console.log("checkin " + JSON.stringify(group));
			seated.sort(function(a,b){
                return ((a.checkout<b.checkout) ? -1 : (a.checkout>b.checkout) ? 1 : 0);
            });
		}
		else{
			queue.push(group);
		}
	}
	while(queue.length){
	    var groupOut = seated[0];
        totalCapacity += groupOut.consumers;
        console.log("checkout " + JSON.stringify(groupOut));
        seated.splice(0,1);
		for(var i=0;i<queue.length;i++){
			var group = queue[i];
			if(totalCapacity-group.consumers>=0){
				totalCapacity -= group.consumers;
				group.served = groupOut.checkout;
				group.checkout = group.served + group.serviceUsage;
				var sMsg = groupOut.checkout>group.checkin ? "served " : "checkin ";
				console.log(sMsg + JSON.stringify(group));
				seated.push(group);
				seated.sort(function(a,b){
                    return ((a.checkout<b.checkout) ? -1 : (a.checkout>b.checkout) ? 1 : 0);
                });
				queue.splice(i,1);
				break;
			}
		}
	}
	return groups;
}

function generateEvents(groups){
	var events = [];
	for(var i=0;i<groups.length;i++){
		var group = groups[i];
		events.push({uid:group.uid, consumers:group.consumers, timestamp:group.checkin, status:0});
		events.push({uid:group.uid, consumers:group.consumers, timestamp:group.checkout, status:1});
	}
	events.sort(function(a,b){
		return ((a.timestamp<b.timestamp) ? -1 : (a.timestamp>b.timestamp) ? 1 : 0);
	});
	return events;
}


function render(){
	$("#log").html("");
	if(displayByGroup){
		for(var i=0, l=groups.length;i<l;i++){
			printGroup(groups[i]);
		}
	}
	else{
		for(var i=0,l=events.length;i<l;i++){
			printEvent(events[i]);
		}
	}
}

readValues();

function addGroup(){
    var nCapacity = parseInt($("#capacity").val());
    if(nCapacity !== capacity){
        readValues();
        reset();
    }
    var event = {};
    event.uid = parseInt($("#groupid").val());
	event.timestamp = parseInt($("#timestamp").val());
	event.status = $("#status")[0].checked ? 1 : 0;
	event.consumers = parseInt($("#persons").val());
    var time = waitingTime(event, predictionType);
    if(time===-1){
        return;
    }

    printEvent(event);
}

function printEvent(event){
    var client = getClients()[event.uid];
    var sClass = client.waitingTime>0 || client.estimatedWaitingTime>0 ? "waited" : "didntwait";
    var sRow = "<p class=\""+ sClass +"\">" + printHour(event.timestamp) + " - #" +client.uid + " (" + client.consumers +"p, "+client.resources+"t) " + (event.status===0 ? "checkin" : client.served !== undefined ? "checkout" : "didnt wait");
    if(event.status === 0 && client.estimatedWaitingTime>0){
        sRow += ", estimatedWaitingTime " + printMinute(client.estimatedWaitingTime) + "min";
    }
    else if(event.status === 0){
        sRow += ", estimatedSeatingTime " + printMinute(client.estimatedSeatingTime) + "min";
    }
    else if(event.status===1 && (client.waitingTime>0 || client.estimatedWaitingTime>0)){
        sRow +=", waited "+ printMinute(client.waitingTime) + ", error "+ printMinute(client.waitingTimeError);
    }
    if(event.status===1){
        sRow +=", stayed "+ printMinute(client.seatingTime) + "min" + ", error "+ printMinute(client.seatingTimeError);
    }
    $("#log").append(sRow + "</p>");
}

function printGroup(group){
    var client = getClients()[group.uid];
    var sClass = client.waitingTime>0 || client.estimatedWaitingTime>0 ? "waited" : "didntwait";
    var sRow = "<p class=\""+ sClass +"\">#" + group.uid + " (" + group.consumers +"p) " + printHour(group.checkin) + " to " + printHour(group.checkout) + " ("+printMinute(group.checkout-group.checkin)+"min)";
    sRow += ", served at " + printHour(client.served) + " ("+ printHour(group.served) + ")";
    sRow += "<br>--- seatingTime " + printMinute(client.seatingTime) + " ("+ (group.serviceUsage)+"), estimate " + printMinute(client.estimatedSeatingTime) + ", error " + printMinute((client.seatingTimeError));
    if(client.waitingTime>0 || client.estimatedWaitingTime>0){
        sRow += "<br>--- waitingTime " + printMinute(client.waitingTime) + " ("+ (group.served - group.checkin)+"), estimate " + printMinute(client.estimatedWaitingTime) + ", error " + printMinute((client.waitingTimeError));
    }
    $("#log").append(sRow + "</p>");
}